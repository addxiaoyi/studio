import { AgentMarketplacePage } from "@/components/agent-marketplace-page";
import { DesktopToastProvider } from "@/components/desktop-toast";

export default function Page() {
  return (
    <DesktopToastProvider>
      <AgentMarketplacePage />
    </DesktopToastProvider>
  );
}
