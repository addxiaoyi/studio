"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Separator } from "./ui/separator";
import { registerLocal, requestLocalCode } from "../lib/local-auth";
import { useAuth } from "../lib/auth-context";
import { t, useLocale } from "@/lib/i18n";

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
} as any;

const fadeIn = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
} as any;

const CODE_RESEND_MS = 60_000;

export function RegisterForm() {
  const locale = t(useLocale());
  const copy = locale.registerForm;
  const authCopy = locale.authForm;
  const { acceptSession } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [codeEmail, setCodeEmail] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));

  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= retryAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  function changeEmail(event: ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value);
    setCode("");
    setError(null);
  }

  async function sendCode() {
    const recipient = email.trim().toLowerCase();
    if (sendingCode || loading || remaining > 0) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setError(copy.invalidEmail);
      return;
    }
    setSendingCode(true);
    setError(null);
    try {
      await requestLocalCode(recipient);
      setCodeEmail(recipient);
      const sentAt = Date.now();
      setNow(sentAt);
      setRetryAt(sentAt + CODE_RESEND_MS);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : authCopy.mailError);
    } finally {
      setSendingCode(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (loading || sendingCode || !trimmed || !password) return;
    if (!consent) {
      setError(copy.consentError);
      return;
    }
    if (password !== confirmPassword) {
      setError(copy.mismatch);
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError(authCopy.codeError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      acceptSession(await registerLocal(trimmed, password, code));
      router.replace("/home");
    } catch (authError) {
      setError(
        authError instanceof Error ? authError.message : copy.createError,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <AnimatePresence mode="wait">
        {sent ? (
          <motion.div
            key="sent"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="flex flex-col items-center gap-4 text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                delay: 0.2,
                type: "spring",
                stiffness: 200,
                damping: 15,
              }}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6 text-background"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
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
            <h2 className="text-lg font-medium">{copy.checkEmail}</h2>
            <p className="text-sm text-muted-foreground">
              {copy.sentTo} <strong>{email}</strong>
            </p>
            <Link
              href="/login"
              className="text-sm text-foreground underline underline-offset-4"
            >
              {copy.backToSignIn}
            </Link>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            variants={stagger}
            initial="hidden"
            animate="visible"
            exit={{ opacity: 0, y: -12, transition: { duration: 0.2 } }}
            className="space-y-6"
          >
            <motion.div variants={fadeIn} className="space-y-2 text-center">
              <h2 className="text-2xl font-medium tracking-tight">
                {copy.create}
              </h2>
              <p className="text-sm text-muted-foreground">
                {copy.description}
              </p>
            </motion.div>

            <motion.form
              variants={fadeIn}
              onSubmit={handleSubmit}
              className="space-y-4"
            >
              <div className="space-y-2.5">
                <Label htmlFor="register-email">{copy.email}</Label>
                <Input
                  id="register-email"
                  type="email"
                  placeholder={copy.placeholder}
                  value={email}
                  onChange={changeEmail}
                  autoComplete="email"
                  disabled={loading || sendingCode}
                  required
                />
              </div>
              <div className="space-y-2.5">
                <Label htmlFor="register-code">{authCopy.codeTitle}</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="register-code"
                    className="min-w-0 flex-1 basis-28"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    placeholder={authCopy.codePlaceholder}
                    value={code}
                    onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    disabled={loading}
                    required
                  />
                  <Button type="button" variant="outline" onClick={sendCode} disabled={loading || sendingCode || remaining > 0}>
                    {sendingCode ? authCopy.sending : remaining > 0 ? `${authCopy.resend} (${remaining}s)` : authCopy.sendCode}
                  </Button>
                </div>
                {codeEmail === email.trim().toLowerCase() && codeEmail && (
                  <p role="status" className="break-words text-xs text-muted-foreground">{authCopy.codeSent} {codeEmail}</p>
                )}
              </div>
              <div className="space-y-2.5">
                <Label htmlFor="register-password">{copy.password}</Label>
                <Input
                  id="register-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2.5">
                <Label htmlFor="register-confirm-password">
                  {copy.confirmPassword}
                </Label>
                <Input
                  id="register-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={loading || sendingCode}
                aria-label={loading ? copy.creating : copy.create}
              >
                {loading ? copy.creating : copy.create}
              </Button>
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  required
                  className="mt-0.5"
                />
                {copy.consent}{" "}
                <Link href="/terms" className="underline">
                  {copy.terms}
                </Link>{" "}
                {copy.or}{" "}
                <Link href="/privacy" className="underline">
                  {copy.privacy}
                </Link>
              </label>
            </motion.form>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden text-center text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <motion.div variants={fadeIn} className="flex items-center gap-4">
              <Separator className="flex-1" />
              <span className="text-xs uppercase text-muted-foreground">
                {copy.or}
              </span>
              <Separator className="flex-1" />
            </motion.div>

            <motion.p
              variants={fadeIn}
              className="text-center text-sm text-muted-foreground"
            >
              {copy.existing}{" "}
              <Link
                href="/login"
                className="font-medium text-foreground underline underline-offset-4"
              >
                {copy.signIn}
              </Link>
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
