"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { t, useLocale } from "@/lib/i18n";
import { getSafeRedirect } from "@/lib/navigation";
import {
  requestLocalCode,
  resetLocalPassword,
  signInLocalWithPassword,
  verifyLocalCode,
} from "../lib/local-auth";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

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
  redirectTo?: string;
  desktopMode?: boolean;
}

type DesktopLoginBridge = {
  startBrowserLogin: () => Promise<{ ok: boolean; message?: string }>;
  cancelBrowserLogin: () => Promise<{ ok: boolean }>;
  onBrowserLoginState: (
    callback: (state: { status: DesktopLoginStatus }) => void,
  ) => () => void;
};

type DesktopLoginStatus =
  | "idle"
  | "opening"
  | "waiting"
  | "exchanging"
  | "completed"
  | "failed"
  | "canceled"
  | "expired";

export function LoginForm({
  initialErrorMessage = null,
  redirectTo = "/home",
  desktopMode = false,
}: LoginFormProps) {
  const copy = t(useLocale()).authForm;
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"code" | "password" | "reset">("code");
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(initialErrorMessage);
  const [isDesktopShell, setIsDesktopShell] = useState(desktopMode);
  const [desktopLoginStatus, setDesktopLoginStatus] =
    useState<DesktopLoginStatus>("idle");
  const [desktopLoginError, setDesktopLoginError] = useState<string | null>(
    null,
  );
  const destination = getSafeRedirect(redirectTo);

  useEffect(() => {
    setIsDesktopShell(
      desktopMode ||
        document.documentElement.dataset.helsteraDesktop === "true",
    );
    const bridge = (window as Window & { electronAPI?: DesktopLoginBridge })
      .electronAPI;
    if (!bridge) return;
    return bridge.onBrowserLoginState(({ status }) =>
      setDesktopLoginStatus(status),
    );
  }, [desktopMode]);

  useEffect(() => {
    if (mode === "code" && error?.includes("请刷新页面后使用邮箱验证码登录")) {
      setError(null);
    }
  }, [error, mode]);

  async function handleCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      if (codeSent) {
        await verifyLocalCode(trimmed, code);
        router.replace(destination);
      } else {
        await requestLocalCode(trimmed);
        setCodeSent(true);
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : copy.mailError);
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    const trimmed = email.trim();
    if (!trimmed || code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      await verifyLocalCode(trimmed, code);
      router.replace(destination);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : copy.codeError);
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

    try {
      await signInLocalWithPassword(trimmed, password);
      router.replace(destination);
    } catch (authError) {
      setError(
        authError instanceof Error ? authError.message : copy.passwordError,
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      if (!codeSent) {
        await requestLocalCode(trimmed);
        setCodeSent(true);
      } else {
        await resetLocalPassword(trimmed, code, password);
        router.replace(destination);
      }
    } catch (authError) {
      setError(
        authError instanceof Error ? authError.message : "密码重置失败，请重试",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openBrowserLogin() {
    if (["opening", "waiting", "exchanging"].includes(desktopLoginStatus))
      return;
    setDesktopLoginStatus("opening");
    setDesktopLoginError(null);
    try {
      const bridge = (window as Window & { electronAPI?: DesktopLoginBridge })
        .electronAPI;
      if (!bridge) {
        setDesktopLoginStatus("failed");
        setDesktopLoginError(
          "桌面登录组件未启动，请重启 Helstera Desktop 后重试。",
        );
        return;
      }
      const result = await bridge.startBrowserLogin();
      if (!result.ok) {
        setDesktopLoginStatus("failed");
        setDesktopLoginError(result.message ?? "暂时无法启动浏览器登录。");
      } else {
        setDesktopLoginStatus("waiting");
      }
    } catch (authError) {
      setDesktopLoginStatus("failed");
      setDesktopLoginError(
        authError instanceof Error
          ? authError.message
          : "暂时无法启动浏览器登录。",
      );
    }
  }

  async function cancelBrowserLogin() {
    const bridge = (window as Window & { electronAPI?: DesktopLoginBridge })
      .electronAPI;
    if (!bridge || desktopLoginStatus !== "waiting") return;
    try {
      await bridge.cancelBrowserLogin();
      setDesktopLoginStatus("canceled");
      setDesktopLoginError(null);
    } catch (authError) {
      setDesktopLoginStatus("failed");
      setDesktopLoginError(
        authError instanceof Error
          ? authError.message
          : "无法取消登录，请重试。",
      );
    }
  }

  if (isDesktopShell) {
    const isOpening = desktopLoginStatus === "opening";
    const isWaiting = desktopLoginStatus === "waiting";
    const isExchanging = desktopLoginStatus === "exchanging";
    const statusMessage = isWaiting
      ? "已打开浏览器。登录后确认此桌面登录请求。"
      : isExchanging
        ? "已确认，正在安全地完成桌面登录…"
        : desktopLoginStatus === "expired"
          ? "登录请求已过期，请重新打开浏览器。"
          : desktopLoginStatus === "canceled"
            ? "登录请求已取消。"
            : desktopLoginStatus === "completed"
              ? "登录成功，正在进入工作区…"
              : null;
    return (
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-2">
          <h2 className="text-2xl font-medium tracking-tight">
            在浏览器中登录
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            登录并确认后，Helstera Desktop 会自动完成登录。
          </p>
        </div>
        <Button
          type="button"
          className="w-full gap-2"
          disabled={
            isOpening || isExchanging || desktopLoginStatus === "completed"
          }
          onClick={() =>
            isWaiting ? void cancelBrowserLogin() : void openBrowserLogin()
          }
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          {isOpening
            ? "正在打开浏览器…"
            : isWaiting
              ? "取消登录"
              : isExchanging
                ? "正在完成登录…"
                : desktopLoginStatus === "completed"
                  ? "已登录"
                  : desktopLoginStatus === "failed" ||
                      desktopLoginStatus === "expired" ||
                      desktopLoginStatus === "canceled"
                    ? "重试登录"
                    : "登录"}
        </Button>
        {statusMessage ? (
          <output className="block text-sm text-muted-foreground">
            {statusMessage}
          </output>
        ) : null}
        {desktopLoginError ? (
          <p role="alert" className="text-sm text-destructive">
            {desktopLoginError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <AnimatePresence mode="wait">
        {codeSent && mode === "code" ? (
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
                aria-hidden="true"
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
            <h2 className="text-lg font-medium">{copy.codeTitle}</h2>
            <p className="text-sm text-muted-foreground">
              {copy.codeSent} <strong>{email}</strong>
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void verifyCode();
              }}
              className="w-full space-y-3"
            >
              <Input
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={copy.codePlaceholder}
                className="text-center text-lg tracking-[0.4em]"
              />
              <Button
                type="button"
                onClick={() => void verifyCode()}
                className="w-full"
                disabled={loading || code.length !== 6}
              >
                {loading ? copy.verifying : copy.verifyLogin}
              </Button>
            </form>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button
              type="button"
              onClick={() => {
                setCodeSent(false);
                setCode("");
              }}
              variant="ghost"
              className="text-xs"
            >
              {copy.resend}
            </Button>
          </motion.div>
        ) : (
          <div key="form" className="space-y-6">
            <motion.div variants={fadeIn} className="space-y-2 text-center">
              <h2 className="text-2xl font-medium tracking-tight">
                {copy.welcome}
              </h2>
              <p className="text-sm text-muted-foreground">
                {copy.signInWorkspace}
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
              onSubmit={
                mode === "password"
                  ? handlePassword
                  : mode === "reset"
                    ? handleReset
                    : handleCode
              }
              className="space-y-4"
            >
              <div className="space-y-2.5">
                <Label htmlFor="email">{copy.email}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={copy.emailPlaceholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {(mode === "password" || mode === "reset") && (
                <div className="space-y-2.5">
                  <Label htmlFor="password">{copy.password}</Label>
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
              {mode === "reset" && codeSent && (
                <div className="space-y-2.5">
                  <Label htmlFor="reset-code">验证码</Label>
                  <Input
                    id="reset-code"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="6 位验证码"
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
                    ? mode === "password"
                      ? copy.loggingIn
                      : mode === "reset"
                        ? codeSent
                          ? "正在设置密码..."
                          : copy.sending
                        : codeSent
                          ? copy.verifying
                          : copy.sending
                    : mode === "password"
                      ? copy.login
                      : mode === "reset"
                        ? codeSent
                          ? "设置新密码"
                          : copy.sendCode
                        : codeSent
                          ? copy.verifyLogin
                          : copy.sendCode
                }
              >
                {loading
                  ? mode === "password"
                    ? copy.loggingIn
                    : mode === "reset"
                      ? codeSent
                        ? "正在设置密码..."
                        : copy.sending
                      : codeSent
                        ? copy.verifying
                        : copy.sending
                  : mode === "password"
                    ? copy.login
                    : mode === "reset"
                      ? codeSent
                        ? "设置新密码"
                        : copy.sendCode
                      : codeSent
                        ? copy.verifyLogin
                        : copy.sendCode}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setMode(
                    mode === "password" || mode === "reset"
                      ? "code"
                      : "password",
                  );
                  setCodeSent(false);
                  setCode("");
                  setError(null);
                }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-all duration-300"
              >
                {mode === "password" || mode === "reset"
                  ? copy.useCode
                  : copy.usePassword}
              </button>
            </form>
            {mode === "password" && (
              <button
                type="button"
                onClick={() => {
                  setMode("reset");
                  setCodeSent(false);
                  setCode("");
                  setError(null);
                }}
                className="w-full text-xs text-muted-foreground hover:text-foreground"
              >
                忘记密码？通过验证码重置
              </button>
            )}

            <motion.p
              variants={fadeIn}
              className="text-center text-sm text-muted-foreground"
            >
              {copy.needAccount}{" "}
              <Link
                href="/register"
                className="font-medium text-foreground underline underline-offset-4"
              >
                {copy.createOne}
              </Link>
            </motion.p>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
