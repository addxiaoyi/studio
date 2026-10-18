"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AgentSection } from "@/components/agent-section";
import { BillingSection } from "@/components/billing-section";
import { CreditUsageHistory } from "@/components/credits/credit-usage-history";
import { ProfileSection } from "@/components/profile-section";
import { SettingsSkeleton } from "@/components/skeletons/settings-skeleton";
import { useAuth } from "@/lib/auth-context";
import {
  ApiAuthError,
  fetchModels,
  fetchViewer,
  fetchWorkspaceSettings,
  updateProfile,
  updateWorkspaceSettings,
  createPublishingAccount,
  fetchPublishingAccounts,
  revokePublishingAccount,
  type PublishingAccount,
} from "@/lib/server-api";

type SettingsTab = "profile" | "agent" | "billing" | "usage";

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "profile", label: "个人资料" },
  { id: "agent", label: "智能体与默认模型" },
  { id: "billing", label: "账单与充值" },
  { id: "usage", label: "用量统计" },
];

export default function SettingsPage() {
  const { session } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialTab = (searchParams.get("tab") as SettingsTab) ?? "profile";
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    tabs.some((t) => t.id === initialTab) ? initialTab : "profile",
  );
  const [profile, setProfile] = useState<{
    displayName: string;
    email: string;
  } | null>(null);
  const [defaultModel, setDefaultModel] = useState<string>("gpt-5.4-mini");
  const [autoApprovePaidGeneration, setAutoApprovePaidGeneration] = useState(false);
  const [autoDeleteEmptyCanvas, setAutoDeleteEmptyCanvas] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [publishingAccounts, setPublishingAccounts] = useState<PublishingAccount[]>([]);
  const [accountBusy, setAccountBusy] = useState(false);

  useEffect(() => {
    const requestedTab = searchParams.get("tab") as SettingsTab | null;
    if (requestedTab && tabs.some((tab) => tab.id === requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [searchParams]);

  // Ref pattern: prevent token refresh from cascading through dependency arrays
  const accessTokenRef = useRef(session?.access_token);
  accessTokenRef.current = session?.access_token;
  const hasInitialized = useRef(false);

  const getToken = useCallback(() => accessTokenRef.current, []);

  const loadData = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setPageLoading(true);

    try {
      const [viewer, settings, accounts] = await Promise.all([
        fetchViewer(token),
        fetchWorkspaceSettings(token),
        fetchPublishingAccounts(token),
      ]);

      setProfile({
        displayName: viewer.profile.displayName,
        email: viewer.profile.email,
      });
      setDefaultModel(settings.settings.defaultModel);
      setAutoApprovePaidGeneration(Boolean(settings.settings.autoApprovePaidGeneration));
      setAutoDeleteEmptyCanvas(Boolean(settings.settings.autoDeleteEmptyCanvas));
      setPublishingAccounts(accounts);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to load settings.");
      if (err instanceof ApiAuthError) {
        // Workspace layout handles auth redirect
        return;
      }
    } finally {
      setPageLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (hasInitialized.current) return;
    if (!session?.access_token) return;
    hasInitialized.current = true;
    loadData();
  }, [session?.access_token, loadData]);

  const handleProfileSave = useCallback(
    async (displayName: string) => {
      const token = getToken();
      if (!token) return;
      const result = await updateProfile(token, { displayName });
      setProfile({
        displayName: result.profile.displayName,
        email: result.profile.email,
      });
    },
    [getToken],
  );

  const handleAgentSave = useCallback(
    async (model: string) => {
      const token = getToken();
      if (!token) return;
      const result = await updateWorkspaceSettings(token, {
        defaultModel: model,
        autoApprovePaidGeneration,
        autoDeleteEmptyCanvas,
      });
      setDefaultModel(result.settings.defaultModel);
    },
    [autoApprovePaidGeneration, autoDeleteEmptyCanvas, getToken],
  );

  const handleAutoApproveChange = useCallback(
    async (value: boolean) => {
      const token = getToken();
      if (!token) return;
      const result = await updateWorkspaceSettings(token, {
        defaultModel,
        autoApprovePaidGeneration: value,
        autoDeleteEmptyCanvas,
      });
      setAutoApprovePaidGeneration(result.settings.autoApprovePaidGeneration);
    },
    [autoDeleteEmptyCanvas, defaultModel, getToken],
  );

  const handleAutoDeleteEmptyCanvasChange = useCallback(
    async (value: boolean) => {
      const token = getToken();
      if (!token) return;
      const result = await updateWorkspaceSettings(token, {
        defaultModel,
        autoApprovePaidGeneration,
        autoDeleteEmptyCanvas: value,
      });
      setAutoDeleteEmptyCanvas(result.settings.autoDeleteEmptyCanvas);
    },
    [autoApprovePaidGeneration, defaultModel, getToken],
  );

  const stableFetchModels = useCallback(() => fetchModels(), []);

  function handleSettingsTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % tabs.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + tabs.length) % tabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex]!;
    setActiveTab(nextTab.id);
    router.replace(`/settings?tab=${nextTab.id}`, { scroll: false });
    document.getElementById(`settings-tab-${nextTab.id}`)?.focus();
  }

  const handleBindAccount = useCallback(async (input: { platform: string; alias: string; connectionMode: PublishingAccount["connection_mode"] }) => {
    const token = getToken();
    if (!token) return;
    setAccountBusy(true);
    try {
      const account = await createPublishingAccount(token, input);
      setPublishingAccounts((current) => [account, ...current.filter((item) => item.id !== account.id)]);
    } finally {
      setAccountBusy(false);
    }
  }, [getToken]);

  const handleRevokeAccount = useCallback(async (accountId: string) => {
    const token = getToken();
    if (!token) return;
    setAccountBusy(true);
    try {
      await revokePublishingAccount(token, accountId);
      setPublishingAccounts((current) => current.filter((item) => item.id !== accountId));
    } finally {
      setAccountBusy(false);
    }
  }, [getToken]);

  if (pageLoading) {
    return <SettingsSkeleton />;
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 sm:px-8" role="alert">
        <h1 className="display-sm text-foreground">无法加载设置</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {pageError ?? "登录状态已失效，请重新登录后再试。"}
        </p>
          <button type="button" onClick={() => void loadData()} className="mt-5 min-h-10 rounded-md border px-3 text-sm font-medium hover:bg-muted">重新加载设置</button>
      </div>
    );
  }

  return (
    <div className="px-6 py-12 sm:px-8 sm:py-16 max-w-6xl mx-auto">
      <header className="mb-12">
        <p className="eyebrow mb-3">设置中心</p>
        <h1 className="display-md text-foreground">工作区设置</h1>
      </header>

      {/* Tab bar — glass pill */}
      <div className="mb-10 overflow-x-auto" role="tablist" aria-label="设置分区" aria-orientation="horizontal">
        <div className="inline-flex gap-1 rounded-full glass-soft p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`settings-tab-${tab.id}`}
              aria-controls="settings-tabpanel"
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onKeyDown={handleSettingsTabKeyDown}
              onClick={() => {
                setActiveTab(tab.id);
                router.replace(`/settings?tab=${tab.id}`, { scroll: false });
              }}
              className={`min-h-[44px] whitespace-nowrap rounded-full px-5 py-2 text-sm transition-all duration-300 sm:min-h-0 sm:px-4 sm:py-1.5 ${
                activeTab === tab.id
                  ? "bg-foreground text-background font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div id="settings-tabpanel" role="tabpanel" aria-labelledby={`settings-tab-${activeTab}`} tabIndex={0} className={activeTab === "billing" ? "max-w-5xl" : "max-w-2xl"}>
        {activeTab === "profile" ? (
          <ProfileSection
            displayName={profile.displayName}
            email={profile.email}
            onSave={handleProfileSave}
            accounts={publishingAccounts}
            accountBusy={accountBusy}
            onBindAccount={handleBindAccount}
            onRevokeAccount={handleRevokeAccount}
          />
        ) : activeTab === "agent" ? (
          <AgentSection
            defaultModel={defaultModel}
            onSave={handleAgentSave}
            fetchModels={stableFetchModels}
            autoApprovePaidGeneration={autoApprovePaidGeneration}
            onAutoApproveChange={handleAutoApproveChange}
            autoDeleteEmptyCanvas={autoDeleteEmptyCanvas}
            onAutoDeleteEmptyCanvasChange={handleAutoDeleteEmptyCanvasChange}
          />
        ) : activeTab === "usage" ? (
          <CreditUsageHistory />
        ) : (
          <BillingSection />
        )}
      </div>
    </div>
  );
}
