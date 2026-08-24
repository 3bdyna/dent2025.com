import os
import io
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from PIL import Image

APP_TITLE = "WebP Background Remover (Solid Color)"


def remove_solid_background(image, tolerance=40, fuzz_color=None):
    img = image.convert("RGBA")
    pixels = img.load()
    w, h = img.size

    if fuzz_color is None:
        bg_samples = [
            (0, 0),
            (w - 1, 0),
            (0, h - 1),
            (w - 1, h - 1),
            (w // 2, 0),
            (0, h // 2),
            (w // 2, h - 1),
            (w - 1, h // 2),
        ]
        rs = gs = bs = 0
        n = 0
        for x, y in bg_samples:
            r, g, b, a = pixels[x, y]
            if a > 200:
                rs += r
                gs += g
                bs += b
                n += 1
        if n == 0:
            bg = (0, 0, 0)
        else:
            bg = (rs // n, gs // n, bs // n)
    else:
        bg = fuzz_color

    br, bg_g, bb = bg
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if (
                abs(r - br) <= tolerance
                and abs(g - bg_g) <= tolerance
                and abs(b - bb) <= tolerance
            ):
                pixels[x, y] = (r, g, b, 0)
    return img


class App:
    def __init__(self, root):
        self.root = root
        root.title(APP_TITLE)
        root.geometry("480x430")
        root.configure(bg="#121212")

        self.input_path = tk.StringVar()
        self.tolerance = tk.IntVar(value=40)
        self.quality = tk.IntVar(value=85)
        self.auto_color = tk.BooleanVar(value=True)
        self.status = tk.StringVar(value="Select a WebP image to start.")

        pad = {"bd": 0, "bg": "#121212", "fg": "#f8fafc"}

        tk.Label(root, text="WebP Background Remover", font=("Outfit", 16, "bold"), **pad).pack(pady=(16, 4))
        tk.Label(root, text="Removes a solid single-color background (keeps corners).", font=("Outfit", 10), **pad).pack()

        btn_frame = tk.Frame(root, bg="#121212")
        btn_frame.pack(pady=16)
        tk.Button(btn_frame, text="Select WebP Image", command=self.select_file,
                  bg="#27272a", fg="#f8fafc", activebackground="#3f3f46",
                  activeforeground="#ffffff", relief="flat", padx=16, pady=8,
                  font=("Outfit", 11)).pack()

        tk.Label(root, textvariable=self.status, bg="#121212", fg="#60a5fa",
                 font=("Outfit", 10), wraplength=420).pack(pady=(0, 8))

        opt = tk.Frame(root, bg="#121212")
        opt.pack(pady=6)
        tk.Checkbutton(opt, text="Auto-detect background from corners", variable=self.auto_color,
                       bg="#121212", fg="#f8fafc", selectcolor="#27272a",
                       activebackground="#121212", activeforeground="#f8fafc",
                       font=("Outfit", 10)).pack(anchor="w")

        trow = tk.Frame(root, bg="#121212")
        trow.pack(pady=4)
        tk.Label(trow, text="Tolerance:", bg="#121212", fg="#e2e8f0", font=("Outfit", 10)).pack(side="left")
        tk.Scale(trow, from_=0, to=150, variable=self.tolerance, orient="horizontal",
                 length=260, bg="#121212", fg="#f8fafc", troughcolor="#27272a",
                 highlightthickness=0, font=("Outfit", 9)).pack(side="left", padx=8)

        qrow = tk.Frame(root, bg="#121212")
        qrow.pack(pady=4)
        tk.Label(qrow, text="Quality:", bg="#121212", fg="#e2e8f0", font=("Outfit", 10)).pack(side="left")
        tk.Scale(qrow, from_=50, to=100, variable=self.quality, orient="horizontal",
                 length=200, bg="#121212", fg="#f8fafc", troughcolor="#27272a",
                 highlightthickness=0, font=("Outfit", 9)).pack(side="left", padx=8)

        tk.Button(root, text="Remove Background & Save", command=self.process,
                  bg="#1d4ed8", fg="#ffffff", activebackground="#1e40af",
                  activeforeground="#ffffff", relief="flat", padx=20, pady=10,
                  font=("Outfit", 12, "bold")).pack(pady=16)

    def select_file(self):
        path = filedialog.askopenfilename(
            title="Select webp image",
            filetypes=[("WebP images", "*.webp"), ("PNG images", "*.png"), ("All files", "*.*")],
        )
        if path:
            self.input_path.set(path)
            self.status.set(f"Loaded: {os.path.basename(path)}")

    def process(self):
        path = self.input_path.get()
        if not path:
            messagebox.showwarning(APP_TITLE, "Please select an image first.")
            return
        try:
            image = Image.open(path)
            if self.auto_color.get():
                result = remove_solid_background(image, self.tolerance.get())
            else:
                color = tk.colorchooser.askcolor(title="Pick background color")
                if not color[0]:
                    return
                result = remove_solid_background(
                    image, self.tolerance.get(), tuple(int(c) for c in color[0])
                )

            base, _ = os.path.splitext(path)
            out_path = base + "_nobg.webp"
            buf = io.BytesIO()
            result.save(buf, format="WEBP", quality=self.quality.get(), method=6)
            with open(out_path, "wb") as f:
                f.write(buf.getvalue())
            self.status.set(f"Saved: {os.path.basename(out_path)}")
            messagebox.showinfo(APP_TITLE, f"Done!\nSaved to:\n{out_path}")
        except Exception as e:
            messagebox.showerror(APP_TITLE, f"Error:\n{e}")


if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
