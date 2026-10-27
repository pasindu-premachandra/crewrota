import argparse
import calendar
import json
import os
import subprocess
import sys
import threading
import time
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import font

WINDOWS = sys.platform == "win32"
if WINDOWS:
    import ctypes

STALE_AFTER = 6 * 3600
WEEK = 7 * 24 * 3600
REFRESH_MS = 30_000
CLOSE_CHECK_MS = 1000
TOKEN_SCAN_SECONDS = 30
TOKEN_KEYS = ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
MUSIC_URL = "https://www.youtube.com/watch?v=tRsQsTMvPNg"

BG = "#16181d"
FG = "#e6e9ef"
MUTED = "#93959b"
LINE = "#2f3136"
SURFACE = "#1e2025"
HOVER_FILL = "#2b2d32"
HOVER_LINE = "#44464b"
GREEN = "#3fb68b"
AMBER = "#e0a43a"
RED = "#e5534b"


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def read(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def percent(data, key, reset_key, now):
    value = number(data.get(key))
    if value is None:
        return None
    reset = number(data.get(reset_key))
    if reset is not None and now > reset:
        return 0
    return round(value)


def reset_time(reset, now):
    if reset is None:
        return "?"
    if reset < now:
        return "-"
    return time.strftime("resets %H:%M", time.localtime(reset))


def reset_day(reset, now):
    if reset is None:
        return "?"
    while reset < now:
        reset += WEEK
    return time.strftime("resets %a %H:%M", time.localtime(reset))


def member_names(home, config):
    names = list(((read(config) or {}).get("members") or {}).keys())
    folder = home / "members"
    if not names and folder.is_dir():
        names = sorted(d.name for d in folder.iterdir() if d.is_dir())
    return names


def newest_reading(home, config):
    newest = 0
    for name in member_names(home, config):
        try:
            newest = max(newest, (home / "members" / name / "quota.json").stat().st_mtime)
        except OSError:
            pass
    return newest


def load_rows(home, config, now):
    rows = []
    for name in member_names(home, config):
        data = read(home / "members" / name / "quota.json") or {}
        ts = number(data.get("ts"))
        rows.append({
            "label": name,
            "ts": ts,
            "five": percent(data, "five_hour_pct", "five_hour_resets_at", now),
            "week": percent(data, "seven_day_pct", "seven_day_resets_at", now),
            "five_reset": reset_time(number(data.get("five_hour_resets_at")), now),
            "week_reset": reset_day(number(data.get("seven_day_resets_at")), now),
            "stale": ts is None or now - ts > STALE_AFTER,
        })
    return rows


# When the newest member reading was measured, not when the widget last redrew.
def read_label(rows, now):
    times = [row["ts"] for row in rows if row["ts"] is not None]
    if not times:
        return "no readings yet"
    newest = max(times)
    same_day = time.localtime(newest)[:3] == time.localtime(now)[:3]
    return time.strftime("read %H:%M" if same_day else "read %a %H:%M", time.localtime(newest))


def compact(n):
    if n >= 1e9:
        return f"{n / 1e9:.1f}B"
    if n >= 1e6:
        return f"{n / 1e6:.1f}M"
    if n >= 1e3:
        return f"{round(n / 1e3)}k"
    return str(n)


# Sums today's usage from the members' session transcripts, reading only bytes added since the last scan.
class TodayTokens:
    def __init__(self, home, config):
        self.home = home
        self.config = config
        self.day = None
        self.scans = 0
        self.total = 0
        self.output = 0

    def start(self):
        threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        while True:
            self.scan()
            self.scans += 1
            time.sleep(TOKEN_SCAN_SECONDS)

    def scan(self):
        now = time.localtime()
        if now[:3] != self.day:
            self.day = now[:3]
            self.midnight = time.mktime(now[:3] + (0, 0, 0, 0, 0, -1))
            self.offsets = {}
            self.seen = set()
            self.total = 0
            self.output = 0
        folders = {(self.home / "members" / name / "projects").resolve() for name in member_names(self.home, self.config)}
        for folder in folders:
            for path in folder.glob("**/*.jsonl"):
                self.read_new_lines(path)

    def read_new_lines(self, path):
        try:
            if path.stat().st_mtime < self.midnight:
                return
            with path.open("rb") as f:
                f.seek(self.offsets.get(path, 0))
                data = f.read()
        except OSError:
            return
        whole = data.rfind(b"\n") + 1
        self.offsets[path] = self.offsets.get(path, 0) + whole
        for line in data[:whole].splitlines():
            if b'"usage"' in line:
                self.add(line)

    def add(self, line):
        try:
            entry = json.loads(line)
        except ValueError:
            return
        message = entry.get("message")
        if not isinstance(message, dict) or not isinstance(message.get("usage"), dict):
            return
        try:
            when = calendar.timegm(time.strptime(str(entry.get("timestamp"))[:19], "%Y-%m-%dT%H:%M:%S"))
        except ValueError:
            return
        key = (message.get("id"), entry.get("requestId"))  # a reply is logged once per content block, same usage each time
        if when < self.midnight or key in self.seen:
            return
        self.seen.add(key)
        usage = message["usage"]
        self.total += sum(int(number(usage.get(k)) or 0) for k in TOKEN_KEYS)
        self.output += int(number(usage.get("output_tokens")) or 0)


def bar_colour(pct):
    if pct >= 80:
        return RED
    if pct >= 60:
        return AMBER
    return GREEN


def blend(colour, alpha):
    fg = [int(colour[i:i + 2], 16) for i in (1, 3, 5)]
    bg = [int(BG[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(b + (f - b) * alpha):02x}" for f, b in zip(fg, bg))


def dim(colour, stale):
    return blend(colour, 0.45) if stale else colour


def screen_box(root):
    if WINDOWS:
        user32 = ctypes.windll.user32
        left, top = user32.GetSystemMetrics(76), user32.GetSystemMetrics(77)
        return left, top, left + user32.GetSystemMetrics(78), top + user32.GetSystemMetrics(79)
    return 0, 0, root.winfo_screenwidth(), root.winfo_screenheight()


def start_position(root, width, position_file):
    left, top, right, bottom = screen_box(root)
    try:
        saved = json.loads(position_file.read_text(encoding="utf-8"))
        x, y = int(saved["x"]), int(saved["y"])
        if left <= x < right and top <= y < bottom:
            return x, y
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return root.winfo_screenwidth() - width - 16, 16


class Widget:
    def __init__(self, args):
        self.home = Path(args.home)
        self.config = Path(args.config)
        self.warmup_command = [args.node, args.cli, "warmup"]
        self.position_file = self.home / "widget.json"
        self.close_file = self.home / "widget.close"
        if WINDOWS:
            try:
                ctypes.windll.shcore.SetProcessDpiAwareness(1)
            except (AttributeError, OSError):
                pass
        self.root = tk.Tk()
        self.root.title("crewrota")
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.configure(bg=BG)
        self.scale = self.root.winfo_fpixels("1i") / 96
        family = "Segoe UI" if WINDOWS else "Helvetica"
        self.title_font = font.Font(family=family, size=10, weight="bold")
        self.name_font = font.Font(family=family, size=9)
        self.bold_font = font.Font(family=family, size=9, weight="bold")
        self.small_font = font.Font(family=family, size=8)
        self.width = self.px(330)
        self.canvas = tk.Canvas(self.root, width=self.width, bg=BG, highlightthickness=0)
        self.canvas.pack()
        self.warming = None
        self.newest = 0
        self.tokens = TodayTokens(self.home, self.config)
        self.token_scans = 0
        self.hovered = None
        self.menu = tk.Menu(self.root, tearoff=0)
        self.menu.add_command(label="Warm up all", command=self.warm_up)
        self.menu.add_command(label="Refresh", command=self.draw)
        self.menu.add_command(label="Quit", command=self.root.destroy)
        self.canvas.bind("<ButtonPress-1>", self.start_drag)
        self.canvas.bind("<B1-Motion>", self.drag)
        self.canvas.bind("<ButtonRelease-1>", self.save_position)
        self.canvas.bind("<Button-3>", lambda event: self.menu.tk_popup(event.x_root, event.y_root))
        for tag in ("music", "warm"):
            self.canvas.tag_bind(tag, "<Enter>", lambda event, tag=tag: self.hover(tag))
            self.canvas.tag_bind(tag, "<Leave>", lambda event: self.hover(None))
        self.canvas.tag_bind("music", "<Button-1>", lambda event: webbrowser.open(MUSIC_URL))
        self.canvas.tag_bind("warm", "<Button-1>", lambda event: self.warm_up())
        x, y = start_position(self.root, self.width, self.position_file)
        self.root.geometry(f"+{x}+{y}")

    def px(self, n):
        return round(n * self.scale)

    def tick(self):
        self.draw()
        self.root.after(REFRESH_MS, self.tick)

    # crew widget close asks by writing widget.close next to widget.pid; a newer quota.json or token scan redraws at once.
    def watch_for_close(self):
        if self.close_file.exists():
            self.close_file.unlink(missing_ok=True)
            self.root.destroy()
            return
        if newest_reading(self.home, self.config) > self.newest or self.tokens.scans != self.token_scans:
            self.draw()
        self.canvas.itemconfigure("clock", text=time.strftime("%H:%M"))
        self.root.after(CLOSE_CHECK_MS, self.watch_for_close)

    def hover(self, tag):
        self.hovered = tag
        self.paint_buttons()

    def paint_buttons(self):
        c = self.canvas
        c.configure(cursor="hand2" if self.hovered else "")
        for tag in ("music", "warm"):
            on = self.hovered == tag
            c.itemconfigure(f"{tag}-box", fill=HOVER_FILL if on else SURFACE, outline=HOVER_LINE if on else LINE)
            c.itemconfigure(f"{tag}-icon", fill=FG if on else MUTED)
        if self.warming:
            c.itemconfigure("warm-icon", fill=AMBER)

    def draw_button(self, tag, x, y):
        self.canvas.create_rectangle(x, y, x + self.px(21), y + self.px(21), fill=SURFACE, outline=LINE, tags=(tag, f"{tag}-box"))

    # Layout from the Open Design spec, in px at 100% scale.
    def draw(self):
        c, px, w = self.canvas, self.px, self.width
        c.delete("all")
        now = time.time()
        self.newest = newest_reading(self.home, self.config)
        rows = load_rows(self.home, self.config, now)
        c.create_text(px(12), px(13), text="crewrota", anchor="w", font=self.title_font, fill=FG)
        status = "warming up..." if self.warming else read_label(rows, now)
        c.create_text(w - px(44), px(14), text=status, anchor="e", font=self.small_font, fill=FG if self.warming else MUTED)
        bx, by = w - px(34), px(4)
        self.draw_button("warm", bx, by)
        bolt = (12, 4, 6, 12, 10, 12, 9, 18, 15, 9, 11, 9)
        c.create_polygon([(bx if i % 2 == 0 else by) + px(n) for i, n in enumerate(bolt)], fill=MUTED, outline="", tags=("warm", "warm-icon"))
        c.create_rectangle(0, px(30), w, px(30) + 1, fill=LINE, outline="")
        if rows:
            c.create_text(px(72), px(41), text="5h", anchor="w", font=self.small_font, fill=MUTED)
            c.create_text(px(206), px(41), text="week", anchor="w", font=self.small_font, fill=MUTED)
            footer = px(88 + 34 * (len(rows) - 1))
        else:
            c.create_text(px(12), px(45), text="No crew members yet. Add one with: crew add <member>", anchor="w", font=self.small_font, fill=MUTED)
            footer = px(60)
        for i, row in enumerate(rows):
            y = px(60 + 34 * i)
            c.create_text(px(12), y, text=row["label"], anchor="w", font=self.name_font, fill=dim(FG, row["stale"]))
            self.draw_meter(px(72), y, row["five"], row["five_reset"], row["stale"])
            self.draw_meter(px(206), y, row["week"], row["week_reset"], row["stale"])
        self.draw_footer(footer)
        height = footer + px(34)
        c.create_rectangle(0, 0, w - 1, height - 1, outline=LINE)
        c.configure(height=height)

    def draw_meter(self, x, y, pct, reset, stale):
        c, px = self.canvas, self.px
        c.create_rectangle(x, y - px(1), x + px(76), y + px(3), fill=dim(LINE, stale), outline="")
        if pct:
            c.create_rectangle(x, y - px(1), x + px(round(76 * min(pct, 100) / 100)), y + px(3), fill=dim(bar_colour(pct), stale), outline="")
        c.create_text(x + px(112), y, text="?" if pct is None else f"{pct}%", anchor="e", font=self.bold_font, fill=dim(FG, stale))
        c.create_text(x, y + px(11), text=reset, anchor="w", font=self.small_font, fill=dim(MUTED, stale))

    def draw_footer(self, top):
        c, px, w = self.canvas, self.px, self.width
        middle = top + px(16)
        self.token_scans = self.tokens.scans
        total = compact(self.tokens.total) if self.token_scans else "..."
        c.create_rectangle(0, top, w, top + 1, fill=LINE, outline="")
        c.create_rectangle(1, top + 1, w - 1, top + px(33), fill=SURFACE, outline="")
        c.create_text(px(12), middle, text=total, anchor="w", font=self.bold_font, fill=FG)
        x = px(12) + self.bold_font.measure(total) + px(4)
        c.create_text(x, middle, text="tokens today", anchor="w", font=self.small_font, fill=MUTED)
        x += self.small_font.measure("tokens today") + px(8)
        if self.token_scans:
            c.create_rectangle(x, top + px(11), x + px(1), top + px(22), fill=LINE, outline="")
            c.create_text(x + px(9), middle, text=f"{compact(self.tokens.output)} out", anchor="w", font=self.small_font, fill=MUTED)
        c.create_text(w - px(44), middle, text=time.strftime("%H:%M"), anchor="e", font=self.name_font, fill=FG, tags="clock")
        bx, by = w - px(34), top + px(6)
        self.draw_button("music", bx, by)
        for shape, x0, y0, x1, y1 in (
            (c.create_rectangle, 9, 5, 17, 7),
            (c.create_rectangle, 9, 7, 10, 15),
            (c.create_rectangle, 16, 7, 17, 14),
            (c.create_oval, 5, 13, 10, 17),
            (c.create_oval, 12, 12, 17, 16),
        ):
            shape(bx + px(x0), by + px(y0), bx + px(x1), by + px(y1), fill=MUTED, outline="", tags=("music", "music-icon"))
        self.paint_buttons()

    def warm_up(self):
        if self.warming:
            return
        flags = subprocess.CREATE_NO_WINDOW if WINDOWS else 0
        self.warming = subprocess.Popen(self.warmup_command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
        self.draw()
        self.wait_for_warm_up()

    def wait_for_warm_up(self):
        if self.warming.poll() is None:
            self.root.after(1000, self.wait_for_warm_up)
            return
        self.warming = None
        self.draw()

    def start_drag(self, event):
        self.offset = (event.x, event.y)

    def drag(self, event):
        self.root.geometry(f"+{event.x_root - self.offset[0]}+{event.y_root - self.offset[1]}")

    def save_position(self, event):
        self.position_file.write_text(json.dumps({"x": self.root.winfo_x(), "y": self.root.winfo_y()}), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="crewrota's quota widget; start it with crew widget.")
    parser.add_argument("--home", required=True, help="the crewrota home, with members/<member>/quota.json")
    parser.add_argument("--config", required=True, help="crewrota's config.json, for the member order")
    parser.add_argument("--node", required=True, help="node, for Warm up all")
    parser.add_argument("--cli", required=True, help="crewrota's cli.js, for Warm up all")
    args = parser.parse_args()
    pid_file = Path(args.home) / "widget.pid"
    Path(args.home).mkdir(parents=True, exist_ok=True)
    pid_file.write_text(str(os.getpid()), encoding="utf-8")
    try:
        widget = Widget(args)
        widget.tokens.start()
        widget.tick()
        widget.watch_for_close()
        widget.root.mainloop()
    finally:
        pid_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
