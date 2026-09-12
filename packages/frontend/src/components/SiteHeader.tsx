import { memo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Menu, Moon, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/useTheme";

interface SiteHeaderProps {
  variant: "landing" | "app";
  onStart: () => void;
  onHome: () => void;
}
const NAV = [
  { href: "#how", label: "Как это работает" },
  { href: "#types", label: "Типы документов" },
  { href: "#bots", label: "Боты" },
];

export const SiteHeader = memo(function SiteHeader({
  variant,
  onStart,
  onHome,
}: SiteHeaderProps) {
  const isLanding = variant === "landing";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const { theme, toggleTheme } = useTheme();
  return (
    <header
      className="site-header"
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          setMenuOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <div className="site-container header-inner">
        <button
          type="button"
          onClick={() => {
            setMenuOpen(false);
            onHome();
          }}
          className="brand"
          aria-label="DocxGen, на главную"
        >
          <span className="brand-wordmark">DocxGen</span>
          <span className="brand-description">Документ за три шага</span>
        </button>
        {isLanding && (
          <nav className="desktop-nav" aria-label="Основная навигация">
            {NAV.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
        )}
        <div className="header-actions">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={
              theme === "light"
                ? "Включить тёмную тему"
                : "Включить светлую тему"
            }
            title={theme === "light" ? "Тёмная тема" : "Светлая тема"}
          >
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </Button>
          {isLanding ? (
            <Button
              className="header-open-button"
              size="sm"
              onClick={() => {
                setMenuOpen(false);
                onStart();
              }}
            >
              Открыть <ArrowUpRight size={16} aria-hidden="true" />
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onHome} aria-label="На главную">
              <ArrowLeft size={16} aria-hidden="true" />
              <span className="home-label">На главную</span>
            </Button>
          )}
          {isLanding && (
            <Button
              ref={menuButton}
              className="mobile-menu-toggle"
              variant="ghost"
              size="icon"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </Button>
          )}
        </div>
      </div>
      {isLanding && menuOpen && (
        <nav
          id="mobile-navigation"
          className="mobile-nav site-container"
          aria-label="Мобильная навигация"
        >
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          ))}
        </nav>
      )}
    </header>
  );
});
