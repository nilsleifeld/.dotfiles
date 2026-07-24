# Telescope

Telescope ist eine schnelle Suche für Dateien und Ordner in deinem aktuellen Projekt.

## Öffnen

Tippe im Eingabefeld von Pi:

```text
@
```

Alternativ kannst du Telescope mit folgendem Befehl öffnen:

```text
/telescope
```

## Funktionen

- Durchsucht Dateien und Ordner im aktuellen Projekt
- Zeigt passende Ergebnisse bereits während der Eingabe
- Fügt die ausgewählte Datei oder den ausgewählten Ordner direkt in das Eingabefeld ein
- Kann eine Vorschau der ausgewählten Datei anzeigen
- Zeigt bei Ordnern deren Inhalt in der Vorschau
- Startet automatisch im `INSERT`-Modus

## Modi

### INSERT

In diesem Modus kannst du deinen Suchbegriff eingeben und bearbeiten.

| Taste | Aktion |
|---|---|
| Text eingeben | Suche ändern |
| `Backspace` | Zeichen vor dem Cursor löschen |
| `Delete` | Zeichen unter dem Cursor löschen |
| `←` / `→` | Cursor bewegen |
| `Ctrl+U` | Suche leeren |
| `Esc` | In den `NORMAL`-Modus wechseln |
| `Enter` | Aktuelles Ergebnis auswählen |

### NORMAL

In diesem Modus kannst du durch die Ergebnisse navigieren.

| Taste | Aktion |
|---|---|
| `j` / `↓` | Nächstes Ergebnis |
| `k` / `↑` | Vorheriges Ergebnis |
| `Page Down` | Zehn Ergebnisse nach unten |
| `Page Up` | Zehn Ergebnisse nach oben |
| `i` | In den `INSERT`-Modus wechseln |
| `p` | Vorschau ein- oder ausschalten |
| `Enter` | Aktuelles Ergebnis auswählen |
| `Esc` / `q` | Telescope schließen |

## Vorschau

Die Vorschau ist beim Öffnen ausgeschaltet. Wechsle mit `Esc` in den `NORMAL`-Modus und drücke `p`, um sie einzuschalten. Mit einem weiteren Druck auf `p` wird sie wieder ausgeschaltet.

Bei Dateien zeigt die Vorschau den Dateiinhalt. Bei Ordnern zeigt sie die enthaltenen Dateien und Unterordner.
