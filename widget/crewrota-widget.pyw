import argparse
import json
import os
import subprocess
import sys
import time
import tkinter as tk
from pathlib import Path
from tkinter import font

WINDOWS = sys.platform == "win32"
if WINDOWS:
    import ctypes

STALE_AFTER = 6 * 3600
WEEK = 7 * 24 * 3600
REFRESH_MS = 30_000
CLOSE_CHECK_MS = 1000

BG = "#16181d"
FG = "#e6e9ef"
WHITE = "#ffffff"
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
        self.label_font = font.Font(family=family, size=9, weight="bold")
        self.small_font = font.Font(family=family, size=8)
        self.width = self.px(330)
        self.canvas = tk.Canvas(self.root, width=self.width, bg=BG, highlightthickness=0)
        self.canvas.pack()
        self.warming = None
        self.newest = 0
        self.menu = tk.Menu(self.root, tearoff=0)
        self.menu.add_command(label="Warm up all", command=self.warm_up)
        self.menu.add_command(label="Refresh", command=self.draw)
        self.menu.add_command(label="Quit", command=self.root.destroy)
        self.canvas.bind("<ButtonPress-1>", self.start_drag)
        self.canvas.bind("<B1-Motion>", self.drag)
        self.canvas.bind("<ButtonRelease-1>", self.save_position)
        self.canvas.bind("<Button-3>", lambda event: self.menu.tk_popup(event.x_root, event.y_root))
        x, y = start_position(self.root, self.width, self.position_file)
        self.root.geometry(f"+{x}+{y}")

    def px(self, n):
        return round(n * self.scale)

    def tick(self):
        self.draw()
        self.root.after(REFRESH_MS, self.tick)

    # crew widget close asks by writing widget.close next to widget.pid; a newer quota.json redraws at once.
    def watch_for_close(self):
        if self.close_file.exists():
            self.close_file.unlink(missing_ok=True)
            self.root.destroy()
            return
        if newest_reading(self.home, self.config) > self.newest:
            self.draw()
        self.root.after(CLOSE_CHECK_MS, self.watch_for_close)

    def draw(self):
        c, px, w = self.canvas, self.px, self.width
        small = self.small_font.metrics("linespace")
        title = self.title_font.metrics("linespace")
        c.delete("all")
        y = px(10)
        now = time.time()
        self.newest = newest_reading(self.home, self.config)
        rows = load_rows(self.home, self.config, now)
        c.create_text(px(12), y, text="crewrota", anchor="nw", font=self.title_font, fill=FG)
        status = "warming up..." if self.warming else read_label(rows, now)
        c.create_text(w - px(12), y + title / 2, text=status, anchor="e", font=self.small_font, fill=blend(FG, 0.65))
        y += title + px(6)
        if not rows:
            c.create_text(px(12), y + px(4), text="No crew members yet. Add one with: crew add <member>", anchor="nw", font=self.small_font, fill=blend(FG, 0.7))
            y += small + px(12)
        bar_width = (w - px(12) * 2 - px(92) - px(8) * 2) / 2
        content = small + px(2) + px(7) + px(3) + small
        for i, row in enumerate(rows):
            alpha = 0.45 if row["stale"] else 1
            if i:
                c.create_line(px(12), y, w - px(12), y, fill=blend(WHITE, 0.06 * alpha))
                y += 1
            top = y + px(5)
            middle = top + content / 2
            c.create_text(px(12), middle, text=row["label"], anchor="w", font=self.label_font, fill=blend(FG, alpha))
            x = px(12) + px(92) + px(8)
            for name, pct, reset in (("5h", row["five"], row["five_reset"]), ("week", row["week"], row["week_reset"])):
                self.draw_bar(x, top, bar_width, name, pct, reset, alpha)
                x += bar_width + px(8)
            y = top + content + px(5)
        y += px(10)
        c.create_rectangle(0, 0, w - 1, y - 1, outline=blend(WHITE, 0.14))
        c.configure(height=y)

    def draw_bar(self, x, top, width, name, pct, reset, alpha):
        c, px = self.canvas, self.px
        text = blend(FG, 0.7 * alpha)
        c.create_text(x, top, text=name, anchor="nw", font=self.small_font, fill=text)
        c.create_text(x + width, top, text="?" if pct is None else f"{pct}%", anchor="ne", font=self.small_font, fill=text)
        y = top + self.small_font.metrics("linespace") + px(2) + px(7) / 2
        r = px(7) / 2
        c.create_line(x + r, y, x + width - r, y, width=px(7), capstyle="round", fill=blend(WHITE, 0.10 * alpha))
        if pct:
            end = x + r + (width - 2 * r) * min(pct, 100) / 100
            c.create_line(x + r, y, end, y, width=px(7), capstyle="round", fill=blend(bar_colour(pct), alpha))
        c.create_text(x, y + r + px(3), text=reset, anchor="nw", font=self.small_font, fill=blend(FG, 0.55 * alpha))

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
        widget.tick()
        widget.watch_for_close()
        widget.root.mainloop()
    finally:
        pid_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
