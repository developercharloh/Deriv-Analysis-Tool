import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type FontSize = "small" | "medium" | "large";

const SIZE_MAP: Record<FontSize, string> = {
  small:  "13px",
  medium: "15px",
  large:  "18px",
};

interface FontSizeCtx {
  fontSize: FontSize;
  setFontSize: (s: FontSize) => void;
}

const Ctx = createContext<FontSizeCtx>({ fontSize: "medium", setFontSize: () => {} });

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSizeState] = useState<FontSize>(() => {
    return (localStorage.getItem("elite-font-size") as FontSize) ?? "medium";
  });

  const setFontSize = (s: FontSize) => {
    setFontSizeState(s);
    localStorage.setItem("elite-font-size", s);
  };

  useEffect(() => {
    document.documentElement.style.fontSize = SIZE_MAP[fontSize];
  }, [fontSize]);

  return <Ctx.Provider value={{ fontSize, setFontSize }}>{children}</Ctx.Provider>;
}

export function useFontSize() {
  return useContext(Ctx);
}
