import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useServices } from "@/api/ServicesProvider";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Status";

export function useConnection() {
  const { connection } = useServices();
  const [status, setStatus] = useState(connection.status());
  useEffect(() => {
    setStatus(connection.status());
    return connection.subscribe(setStatus);
  }, [connection]);
  return { status, reconnect: () => connection.reconnect() };
}

/** Shown while a session is active and the service link is down. Drafts are never discarded. */
export function ConnectionBanner() {
  const { status, reconnect } = useConnection();
  if (status === "online") return null;
  return (
    <div className="connection-banner">
      {status === "disconnected" ? (
        <Notice
          tone="warning"
          title="Disconnected from the service"
          action={
            <Button variant="secondary" icon={<RefreshCw size={18} />} onClick={() => void reconnect()}>
              Reconnect
            </Button>
          }
        >
          Your drafts and transcript are kept on this screen. Suggestions and speech will be available again after reconnecting.
        </Notice>
      ) : (
        <Notice tone="pending" title="Reconnecting…">Trying to reach the service again. You can keep editing your draft.</Notice>
      )}
    </div>
  );
}
