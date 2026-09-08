"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import { Sun, Moon, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { HelsteraLogo } from "@/components/icons/helstera-logo";

const NAV_LINKS = [
  { label: "功能", href: "#features" },
  { label: "解决方案", href: "#solutions" },
  { label: "客户案例", href: "#customers" },
  { label: "定价", href: "#pricing" },
] as const;

function handleAnchorClick(
  e: React.MouseEvent<HTMLAnchorElement>,
  href: string,
  onClose?: () => void,
) {
  if (href.startsWith("#")) {
    e.preventDefault();
    document.querySelector(href)?.scrollIntoView({ behavior: "smooth" });
    // Keep URL in sync with anchor so the user can share / refresh
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", href);
    }
    onClose?.();
  }
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="size-8" aria-hidden="true" />;

  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
      title={theme === "dark" ? "浅色模式" : "深色模式"}
      className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-all duration-200 focus-visible:ring-2 focus-visible:ring-foreground/20"
    >
      {theme === "dark" ? (
        <Sun className="size-4" strokeWidth={1.5} />
      ) : (
        <Moon className="size-4" strokeWidth={1.5} />
      )}
    </button>
  );
}

function NavCTA() {
  return (
    <Link
      href="/register"
      className={cn(
        "hidden md:inline-flex items-center justify-center h-8 px-4 rounded-full",
        "bg-foreground text-background text-sm font-medium",
        "transition-all duration-300 hover:scale-[1.02] active:scale-[0.99]",
      )}
    >
      免费试用
    </Link>
  );
}

export function FloatingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-500",
        scrolled
          ? "glass-strong border-b border-white/15"
          : "bg-transparent",
      )}
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0 group">
            <HelsteraLogo className="size-7" />
            <span className="font-medium text-base tracking-tight">Helstera</span>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-1.5" aria-label="Main navigation">
            {NAV_LINKS.map(({ label, href }) => (
              <a
                key={href}
                href={href}
                onClick={(e) => handleAnchorClick(e, href)}
                className={cn(
                  "relative px-3.5 py-2 text-sm text-muted-foreground hover:text-foreground transition-all duration-300",
                  "after:absolute after:bottom-1 after:left-3.5 after:right-3.5 after:h-px after:w-0 after:bg-foreground after:transition-all after:duration-300",
                  "hover:after:w-[calc(100%-1.75rem)]",
                )}
              >
                {label}
              </a>
            ))}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <NavCTA />
            <button
              type="button"
              className="md:hidden inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-all duration-300"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? (
                <X className="size-4" strokeWidth={1.5} />
              ) : (
                <Menu className="size-4" strokeWidth={1.5} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="md:hidden overflow-hidden border-t border-border/30 glass-strong"
          >
            <nav className="px-6 py-4 flex flex-col gap-1.5" aria-label="Mobile navigation">
              {NAV_LINKS.map(({ label, href }) => (
                <a
                  key={href}
                  href={href}
                  onClick={(e) =>
                    handleAnchorClick(e, href, () => setMobileOpen(false))
                  }
                  className="px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground rounded-md transition-all duration-300"
                >
                  {label}
                </a>
              ))}
              <Link
                href="/register"
                onClick={() => setMobileOpen(false)}
                className="mt-2 inline-flex items-center justify-center h-9 w-full rounded-full bg-foreground text-background text-sm font-medium"
              >
                免费试用
              </Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
