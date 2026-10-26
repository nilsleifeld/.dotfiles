# Sicherer SSH-Agent für Pi

Lokales Entsperren privater SSH-Keys ohne Passphrase im Chat, Tool-Ergebnis oder LLM-Kontext. Keine zusätzlichen Laufzeit-Dependencies; Node-Standardbibliothek, OpenSSH und die von Pi bereitgestellten Pakete.

## Installation

Voraussetzungen: aktuelle Pi-Version mit `@earendil-works/*`-API, Node ≥ 22.19, Unix/Linux und OpenSSH unter `/usr/bin`. Auf Ubuntu:

```sh
sudo apt install openssh-client
```

Das gesamte Verzeichnis `ssh-agent` gehört nach `~/.pi/agent/extensions/`. In diesen Dotfiles zeigt `~/.pi/agent/extensions` bereits auf `.config/.pi/agent/extensions`: **`/reload` genügt**. Nicht zusätzlich denselben Ordner als Paket installieren.

Alternativ einmalig ausprobieren, aus dem Repository-Root:

```sh
pi -e ./.config/.pi/agent/extensions/ssh-agent/index.ts
```

Oder den Ordner explizit in der `extensions`-Liste von `~/.pi/agent/settings.json` eintragen. Ein anderer Agent-Ordner ist über `PI_CODING_AGENT_DIR` möglich. Kein Build, kein `eval`, kein `npm install` für den Betrieb nötig.

Geprüft gegen die tatsächlich installierte **Pi 1.1.0** API. Recherchegrundlage waren deren `docs/extensions.md`, `docs/tui.md`, Konfigurations-/Paketdokumentation, die öffentlichen Typdeklarationen und die Beispiele `ssh.ts`, `bash-spawn-hook.ts` und `hello.ts`. Das SSH-Beispiel unterstützt nur bereits entsperrte Keys; ein Passwortdialog wird dort nicht angeboten. `ui.input()` hat keine Maskierungsoption: hierfür wird ausschließlich `ui.custom()` verwendet. Ältere Pi-Versionen mit `@mariozechner/*` werden nicht unterstützt.

## Verwendung

| Aufruf | Wirkung |
| --- | --- |
| `/ssh-unlock` | Private Keys auswählen; auch freier Pfad möglich |
| `/ssh-unlock ~/.ssh/mein-key` | Diesen Pfad lokal bestätigen und laden |
| `ssh_unlock({})` | Gleiches Verhalten als Agent-Tool |
| `ssh_unlock({keyPath: "/absoluter/pfad"})` | Expliziten Key lokal bestätigen |
| `/ssh-status` | Agent-Erreichbarkeit, geladene Namen/Kommentare und SHA256-Fingerprints |
| `/ssh-keys` | Gefundene private Key-Pfade und verfügbare Fingerprints |
| `/ssh-lock` | Einen geladenen Key nach Bestätigung entfernen |

**Passphrasen ausschließlich in den maskierten Dialog eingeben**, niemals als Argument, im Chat oder in das Dateipfad-Feld. Die `/ssh-unlock`-Argumente sind der gesamte Pfad, ohne Shell-Quoting; Leerzeichen sind erlaubt. Im Pfad-Feld werden `~` und `~/` unterstützt, keine Shell-Expansion oder Variablen.

Der Dialog unterstützt Unicode, Kitty-Tastaturprotokoll, Backspace, Ctrl-U zum Löschen, Enter sowie Esc/Ctrl-C zum Abbrechen. Einfügen ist möglich; mehrzeilige Eingaben werden verworfen. Die Maske hat unabhängig von der Länge acht Punkte. Maximal 16 KiB UTF-8, zwei Minuten pro Dialog, drei Eingaben und drei Minuten pro Ladevorgang.

Bereits identifizierbare geladene Keys werden markiert und nicht erneut entschlüsselt. Eine eigene Dateikopie oder Änderung der SSH-Konfiguration erfolgt nicht. Das Laden eines Keys beweist **keinen Serverzugriff**.

### Dauerhafter Status

Die normale Pi-Statusleiste zeigt über `ctx.ui.setStatus()`:

- 🔴 `SSH: Kein Agent`
- 🟡 `SSH: Kein Key geladen`
- 🟢 `SSH: 1 Key geladen` bzw. die tatsächliche Anzahl
- 🔄 `SSH: Entsperrung läuft`

Aktualisierung bei Session-Start/-Wechsel, nach Operationen und alle fünf Sekunden. Das Polling startet keinen Agenten. Externes Laden/Entfernen sowie ein nicht mehr erreichbarer Agent werden so erkannt, ohne Benachrichtigungen zu erzeugen. Ein eigener Footer einer anderen Extension muss Pi-Extension-Statusfelder darstellen, damit diese sichtbar bleiben.

## Automatisierung und sichere Grenzen

Die Extension registriert das Modell-Tool, vier Slash-Commands sowie die realen Hooks `tool_call`, `tool_result`, `agent_start`, `session_start` und `session_shutdown`. Auch Bash-Aufrufe aus `codemode` durchlaufen diese Hooks.

1. Vor einfachen `ssh …`-/Git-Bash-Aufrufen mit erkennbarem SSH-Transport wird bei leerem Agenten das Entsperren angeboten. Bei einfachen `git fetch/pull/push` wird zusätzlich die konfigurierte `origin`-URL gelesen. HTTPS-Klone lösen keinen vorsorglichen Dialog aus.
2. Mehrere mögliche Keys werden **immer vom Benutzer ausgewählt**. Aus Key-Dateien lässt sich nicht beweisen, welchen Key ein Server akzeptiert.
3. Bei `Permission denied (...publickey...)` wird höchstens einmal pro Agent-Lauf angeboten, einen Key zu laden. Die Erklärung nennt auch falschen Benutzer/Key oder fehlende Serverberechtigung als mögliche Ursachen. Host-Key-, Netzwerk-, Passwort-only-Fehler und „Too many authentication failures“ werden nicht als Entsperrproblem behandelt.
4. **Kein fehlgeschlagener Befehl wird von der Extension automatisch erneut ausgeführt.** Beliebiger Shell-Code, Remote-Commands, Clone-Hooks, Pull-Merges und Push-Hooks erlauben keine verlässliche allgemeine Aussage über bereits erfolgte Nebenwirkungen. Für einen identischen erneuten Bash-Befehl nach erkanntem Public-Key-Fehler ist eine lokale Benutzerbestätigung erforderlich; ohne TUI wird er blockiert. Das ist eine Wiederholungssperre, keine allgemeine Shell-Sandbox: semantisch gleiche, anders formulierte Befehle können nicht zuverlässig identifiziert werden.
5. Zusammengesetzte Shell-Befehle, Wrapper und andere Remotes als `origin` bekommen gegebenenfalls erst den Fehlerhinweis statt eines Preflights. Für diese Fälle vorab `/ssh-unlock` oder `ssh_unlock` verwenden. Die Extension analysiert und wiederholt keinen beliebigen Shell-Code.

Die Extension ersetzt das registrierte `bash`-Tool über die offizielle `createBashTool()`-Factory. Ihr `spawnHook` erzwingt für dessen SSH-Prozesse einen fehlschlagenden Askpass-Helfer (`/usr/bin/false`), statt native Passphrase-/Passwortdialoge über `/dev/tty` zuzulassen. Erst der separate `ssh-add`-Prozess erhält den sicheren Helfer. **Host-Key-Abfragen werden ebenfalls nicht automatisch bestätigt**: Fingerprints außerhalb des Agents prüfen und den Host vertrauenswürdig in `known_hosts` aufnehmen.

Andere Extensions, die `bash` ersetzen (z. B. Remote-/Sandbox-Tools), können mit diesem Override kollidieren; nur ein Override sollte aktiv sein. `!`-Benutzershells, `pi.exec()`, MCP-Server und beliebige externe Prozesse werden nicht ersetzt. Nach dem Entsperren erben neu gestartete lokale Kindprozesse `SSH_AUTH_SOCK`; bereits laufende Prozesse und Sandbox-/Remote-Umgebungen nicht. Explizites `IdentityAgent`, `IdentitiesOnly`, eigenes `GIT_SSH_COMMAND` oder eigene SSH-Konfiguration können die Nutzung des Agenten einschränken. Die Extension verändert diese Einstellungen nicht.

### Key-Erkennung

- Reguläre eigene Dateien unter `~/.ssh/`, unabhängig vom Dateinamen oder Key-Algorithmus.
- OpenSSH-Format sowie RSA/EC/DSA/PKCS8-PEM-Header; tatsächliche Format-/Algorithmusunterstützung übernimmt OpenSSH. Keine Aktivierung veralteter SSH-Algorithmen.
- Zusätzlich statische `IdentityFile`-Einträge aus `~/.ssh/config` und `Include`-Dateien; Quotes, `%d`, `%u`, `%%`, `~` sowie `*`/`?` im letzten Include-Pfadsegment. Rekursion ist begrenzt. Relative Include-Pfade beziehen sich auf `~/.ssh`.
- Keine Ausführung von `Match exec`, kein `ssh -G`, keine Auswertung von Proxy-Kommandos. Host-/Match-Blöcke werden nur zur Sammlung gelesen, nicht als vollständige SSH-Konfiguration interpretiert. Deshalb erscheinen auch Keys anderer Hosts zur Auswahl. Hostabhängige Tokens wie `%h`, Umgebungsvariablen, verschachtelte Glob-Verzeichnisse und Systemkonfigurationen sind kein Bestandteil der automatischen Erkennung; dafür freie Pfadauswahl verwenden.
- Symlinks werden zunächst aufgelöst, der eigentliche Key muss dem aktuellen Benutzer gehören und Modus 0600 oder strenger haben. Nichtreguläre Dateien, Dateien > 1 MiB und unsichere Rechte werden abgelehnt; keine automatische Rechteänderung.
- Verschlüsselte alte PEM-/PKCS8-Dateien ohne lesbaren öffentlichen Anteil lassen sich vor dem Entschlüsseln nicht immer einem geladenen Agent-Key zuordnen. Nach eigenem Laden wird die Zuordnung für unveränderte Dateien im aktuellen Runtime gespeichert. Bei schon vorher extern geladenen Legacy-Keys kann eine erneute Abfrage nötig sein. Moderne OpenSSH-Keys enthalten den öffentlichen Anteil und haben diese Einschränkung nicht.

### Agent-Lebensdauer

Ein über `SSH_AUTH_SOCK` erreichbarer Agent wird bevorzugt und niemals beendet. Ein fehlender/defekter Agent wird erst beim Entsperren durch einen eigenen `ssh-agent -D` mit privatem Socket ersetzt. Gleichzeitige Startanfragen teilen sich denselben Startvorgang. Es werden keine Shell-Ausgaben von `ssh-agent` ausgewertet; `SSH_AUTH_SOCK` genügt, `SSH_AGENT_PID` wird nicht benötigt.

Bei normalem Beenden, Reload und Session-Wechsel werden nur eigene Agent-Prozesse beendet, die vorherige Socket-Umgebung wiederhergestellt und temporäre Dateien entfernt. Keys im eigenen Agenten müssen nach einem solchen Wechsel gegebenenfalls neu geladen werden. Fremde Agenten und deren übrige Keys bleiben erhalten. `/ssh-lock` wirkt hingegen absichtlich auch auf andere Benutzerprozesse desselben Agenten.

RPC, Print und JSON erhalten **keinen Passwort-Fallback**: Ein externer, bereits entsperrter Agent kann verwendet werden; interaktives Entsperren schlägt mit einer klaren Meldung fehl.

## Sicherheitsarchitektur und geprüfte Grenzen

```text
lokaler Pi-Custom-Dialog
    → kurzlebiger Buffer
    → privater Unix-Socket mit Zufallstoken
    → kurzlebiger Node-Askpass-Prozess
    → private Askpass-Pipe von ssh-add
    → SSH-Agent
```

- Passphrasen niemals in Tool-Parametern/-Ergebnissen, Chat-Nachrichten, persistenten Session-Einträgen, Argumenten oder Umgebungsvariablen.
- Der Helper enthält nur Socket-Pfad und zufälliges IPC-Token, **keine Passphrase**. Neues zufälliges Verzeichnis unter `/tmp`, Verzeichnis/Helper 0700, Socket 0600; kein gemeinsam beschreibbarer Dateiname. Tokenprüfung, begrenzte Requests und jeweils ein Dialog schützen die IPC.
- `spawn()` verwendet Argumentarrays statt Shell-Code. Der validierte private Key wird über einen vererbten Dateideskriptor an `ssh-add` übergeben, nicht über einen erneut geöffneten Dateipfad. Das verhindert Pfadaustausch zwischen Validierung und Laden. Eine Änderung des Inodes durch dessen Eigentümer ist damit nicht ausgeschlossen.
- `ssh-add`-Ausgaben werden verworfen, Fehler nur als feste bzw. bereinigte Meldungen ausgegeben. Fingerprints und Kommentare werden für die UI von Steuerzeichen bereinigt.
- Separate Eingabekomponente ohne Pi-Input-History, Undo oder Kill-Ring. Löschbare Buffer werden überschrieben, temporäre Ressourcen auch bei Abbruch, falscher Eingabe und Timeout entfernt.
- **Keine Sicherheitsgrenze gegenüber root, Prozessen desselben Benutzers, bösartigen Extensions oder einem Agenten mit beliebiger lokaler Codeausführung.** Diese können Prozessspeicher, Terminaleingaben oder Agent-Sockets angreifen. JavaScript, Node, OpenSSH und das OS können zusätzliche kurzlebige Kopien, Swap oder Core-Dumps erzeugen; sicheres Zeroing aller Kopien oder `mlock` wird nicht behauptet. Terminal-/Input-Recorder und untrusted Extensions nicht parallel verwenden. Die Extension sendet im normalen Datenfluss keine Passphrase an das Modell, stellt aber keine OS-Sandbox her.
- Bei SIGKILL, Stromausfall oder Runtime-Absturz ist `finally` nicht garantiert: eigene Agenten/temporäre Verzeichnisse können zurückbleiben. Darin stehen keine gespeicherten Passphrasen; ein noch laufender Agent enthält jedoch entschlüsselte Keys. Solche verwaisten Prozesse gezielt beenden, nicht pauschal fremde Agenten töten. Ein `/tmp` mit `noexec` verhindert den Helper-Start und führt zum sicheren Fehlschlag.

## Tests

Mit lokal installierten Entwicklungs-/Peer-Paketen:

```sh
cd .config/.pi/agent/extensions/ssh-agent
npm install --ignore-scripts
npm test
npm run typecheck
```

Ohne Installation zusätzlicher Pakete gegen eine vorhandene npm-Pi-Installation:

```sh
PI_TEST_HOST="$(npm root -g)/@earendil-works/pi-coding-agent/package.json" \
  node --experimental-strip-types --test tests/*.test.ts
```

`PI_TEST_HOST` ist ausschließlich eine Testhilfe für Pis gebündelte Dependencies; gegebenenfalls den tatsächlichen Installationspfad angeben. Core-Tests benötigen keine npm-Pakete: `node --experimental-strip-types --test tests/core.test.ts`.

Die Tests erzeugen ausschließlich kurzlebige Test-Keys und eigene Agenten. Auch Test-Passphrasen werden nicht in Prozessargumente oder Umgebungsvariablen geschrieben. Abgedeckt: Erkennung/Includes, Dateirechte/FIFOs, freie Pfadauswahl, paralleler Agent-Start, Wiederverwendung/fremde Agenten, verschlüsseltes RSA/Ed25519, IPC-Bereinigung, falsche Passphrasen/Retry-Limit, Abbruch/Timeout, maskierte Unicode-/Kitty-Eingabe, Tool-Ergebnisse ohne Geheimnis, bereits geladene Keys, Fehlerklassifikation, Wiederholungssperre, UI-Status, echter Pi-Extension-Loader und Bash-Integration.

Validiert: **26 Tests auf macOS und 26 Tests in einem netzwerkisolierten Debian-13-Linux-Container**, jeweils mit echten OpenSSH-Prozessen; zusätzlich strikter TypeScript-Check gegen die installierte API. Kein echter GitHub-/Serverzugriff, kein manueller Terminal-End-to-End-Test und kein separater Ubuntu-Lauf wurden durchgeführt. Serverberechtigungen und Host-Trust müssen vor Ort geprüft werden.
