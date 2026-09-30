"use client";
/**
 * KeyboardShortcuts — a small cheatsheet dialog listing every shortcut in the
 * workbench. Opens with "?" (when not typing) or the topbar keyboard button.
 */
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAppStore } from "@/lib/store";

interface ShortcutRow {
  keys: string[];
  description: string;
}

const SECTIONS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: "Global",
    rows: [
      { keys: ["⌘", "K"], description: "Open the command palette (Ctrl K on Windows/Linux)" },
      { keys: ["?"], description: "Show this shortcuts cheatsheet" },
      { keys: ["esc"], description: "Close dialogs and the palette" },
    ],
  },
  {
    title: "Jump to a view (g then key)",
    rows: [
      { keys: ["g", "h"], description: "Analyze (home)" },
      { keys: ["g", "r"], description: "Review queue" },
      { keys: ["g", "a"], description: "Operations analytics" },
      { keys: ["g", "e"], description: "Appeals" },
      { keys: ["g", "u"], description: "Audit log" },
      { keys: ["g", "s"], description: "Trusted-source registry" },
      { keys: ["g", "m"], description: "Model card & release gates" },
    ],
  },
  {
    title: "Composer",
    rows: [
      { keys: ["⌘", "↩"], description: "Verify the statement with evidence (Ctrl ↩ on Windows/Linux)" },
    ],
  },
  {
    title: "Command palette",
    rows: [
      { keys: ["↑", "↓"], description: "Move the selection" },
      { keys: ["↵"], description: "Open the selected view, analysis or action" },
    ],
  },
  {
    title: "Review queue",
    rows: [
      { keys: ["j", "k"], description: "Select the next / previous card (or ↑/↓)" },
      { keys: ["↵", "o"], description: "Open the selected analysis dossier" },
      { keys: ["esc"], description: "Clear the selection" },
    ],
  },
  {
    title: "Analysis dossier",
    rows: [
      { keys: ["click"], description: "Claim chips scroll between claims (multi-claim dossiers)" },
    ],
  },
];

export function KeyboardShortcuts() {
  const { status } = useSession();
  const open = useAppStore((s) => s.shortcutsOpen);
  const setOpen = useAppStore((s) => s.setShortcutsOpen);
  const authenticated = status === "authenticated";

  /* "?" opens the cheatsheet — ignored while typing in a field. */
  useEffect(() => {
    if (!authenticated) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authenticated, setOpen]);

  return (
    <Dialog open={open && authenticated} onOpenChange={setOpen}>
      <DialogContent
        className="top-[16%] max-w-md translate-y-0 gap-0 overflow-hidden border-zinc-800 bg-zinc-900/95 p-0 shadow-2xl shadow-black/40 backdrop-blur-xl"
        aria-describedby={undefined}
      >
        <DialogTitle className="border-b border-zinc-800 px-4 py-3 text-sm font-medium text-zinc-100">
          Keyboard shortcuts
        </DialogTitle>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {SECTIONS.map((section) => (
            <section key={section.title} className="mb-1 last:mb-0" aria-label={section.title}>
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {section.title}
              </p>
              <ul>
                {section.rows.map((row) => (
                  <li
                    key={row.description}
                    className="flex items-center justify-between gap-4 rounded-md px-3 py-2 hover:bg-zinc-800/50"
                  >
                    <span className="text-[13px] text-zinc-300">{row.description}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((k, i) => (
                        <kbd key={`${row.description}-${i}`} className="veritas-kbd" aria-hidden>
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="border-t border-zinc-800 bg-zinc-950/60 px-4 py-2 text-[10px] text-zinc-600">
          Evidence first, verdict second — shortcuts accelerate navigation, never bypass human
          review (BR-11).
        </p>
      </DialogContent>
    </Dialog>
  );
}
