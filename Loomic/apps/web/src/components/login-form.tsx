"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { requestMagicLink, fetchViewer } from "../lib/server-api";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
} as any;

const fadeIn = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
} as any;

interface LoginFormProps {
  initialErrorMessage?: string | null;
}

export function LoginForm({ initialErrorMessage = null }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"otp" | "password">("otp");
  const [loading, setLoading] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(initialErrorMessage);

  async function bootstrapWorkspace(accessToken: string) {
    try {
      await fetchViewer(accessToken);
      router.replace("/home");
    } catch {
      setError("Could not load your workspace. Please try again.");
    }
  }

  async function handleMagicLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      await requestMagicLink(trimmed);
      setLinkSent(true);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "登录邮件发送失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function handlePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !password) return;
    setLoading(true);
    setError(null);

    const supabase = getSupabaseBrowserClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: trimmed,
      password,
    });

    if (authError) {
      setLoading(false);
      setError(authError.message);
    } else {
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        setLoading(false);
        setError("Could not finish signing in. Please try again.");
        return;
      }

      await bootstrapWorkspace(accessToken);
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <AnimatePresence mode="wait">
              {linkSent && mode === "otp" ? (
          <motion.div
            key="sent"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="flex flex-col items-center gap-4 text-center"
          >
            {/* Checkmark circle */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 15 }}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-background" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <motion.path
                  d="M5 13l4 4L19 7"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ delay: 0.5, duration: 0.4, ease: "easeOut" }}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </motion.div>
            <h2 className="text-lg font-medium">Check your email</h2>
            <p className="text-sm text-muted-foreground">
              We sent a login link to <strong>{email}</strong>
            </p>
          </motion.div>
        ) : (
          <div key="form" className="space-y-6">
            <motion.div variants={fadeIn} className="space-y-2 text-center">
              <h2 className="text-2xl font-medium tracking-tight">Welcome back</h2>
              <p className="text-sm text-muted-foreground">
                Sign in to your workspace
              </p>
            </motion.div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  role="alert"
                  aria-live="polite"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <form
              onSubmit={mode === "password" ? handlePassword : handleMagicLink}
              className="space-y-4"
            >
              <div className="space-y-2.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {mode === "password" && (
                <div className="space-y-2.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={loading}
                aria-label={
                  loading
                    ? mode === "password" ? "正在登录" : "正在发送登录链接"
                    : mode === "password" ? "登录" : "发送登录链接"
                }
              >
                {loading
                  ? mode === "password" ? "正在登录..." : "正在发送登录链接..."
                  : mode === "password" ? "登录" : "发送登录链接"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "password" ? "otp" : "password");
                  setError(null);
                }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-all duration-300"
              >
                {mode === "password" ? "使用验证码登录" : "使用密码登录"}
              </button>
            </form>

            <motion.p variants={fadeIn} className="text-center text-sm text-muted-foreground">
              Need an account?{" "}
              <Link href="/register" className="font-medium text-foreground underline underline-offset-4">
                Create one
              </Link>
            </motion.p>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
