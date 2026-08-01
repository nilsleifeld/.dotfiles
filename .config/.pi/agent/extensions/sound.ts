import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const sound = fileURLToPath(new URL("./sound.mp3", import.meta.url));

export default function (pi: ExtensionAPI) {
  pi.on("agent_settled", async () => {
    await pi.exec("/usr/bin/afplay", [sound]);
  });
}
