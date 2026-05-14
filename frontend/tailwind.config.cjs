module.exports = {
  darkMode: "class",
  content: {
    relative: true,
    files: ["./index.html", "./src/**/*.{ts,tsx}"],
  },
  safelist: [
    "border-emerald-800/60", "bg-emerald-950/40", "text-emerald-200",
    "border-amber-500", "bg-amber-900/70", "text-amber-100",
    "ring-amber-500/50", "shadow-amber-900/40",
    "border-blue-800/60", "bg-blue-950/40", "text-blue-200",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};
