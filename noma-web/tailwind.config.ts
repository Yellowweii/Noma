import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f7ff",
          100: "#e0effe",
          200: "#b9dffd",
          300: "#7cc5fd",
          400: "#36a7f8",
          500: "#0c8ce9",
          600: "#006fc7",
          700: "#0159a1",
          800: "#064c85",
          900: "#0b406e",
        },
        noma: {
          canvas: "var(--background)",
          primary: "var(--noma-text-primary)",
          secondary: "var(--noma-text-secondary)",
          tertiary: "var(--noma-text-tertiary)",
          border: "var(--noma-border)",
          soft: "var(--noma-surface-soft)",
          placeholder: "var(--noma-placeholder)",
          brand: {
            DEFAULT: "var(--noma-brand)",
            hover: "var(--noma-brand-hover)",
            focus: "var(--noma-brand-focus)",
            surface: "var(--noma-surface-brand)",
            active: "var(--noma-surface-brand-active)",
          },
          action: {
            DEFAULT: "var(--noma-action)",
            hover: "var(--noma-action-hover)",
            surface: "var(--noma-action-surface)",
          },
          active: {
            DEFAULT: "var(--noma-active)",
            surface: "var(--noma-active-surface)",
          },
          send: {
            disabled: "var(--noma-send-disabled-bg)",
            "disabled-text": "var(--noma-send-disabled-text)",
          },
          toast: {
            bg: "var(--noma-toast-bg)",
            text: "var(--noma-toast-text)",
          },
        },
      },
      boxShadow: {
        "noma-toast": "var(--noma-toast-shadow)",
      },
      borderRadius: {
        pill: "var(--radius-pill)",
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "PingFang SC",
          "var(--font-noto-sans-sc)",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
