"use client";
/**
 * CopyButton — copies text to the clipboard with quiet inline feedback
 * (icon swap Copy → Check for 1.6s) instead of a noisy toast.
 *
 * Uses the async Clipboard API first, falling back to a temporary textarea +
 * execCommand for restricted contexts (iframes, unfocused headless windows).
 */
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Legacy fallback for contexts where navigator.clipboard is unavailable. */
function legacyCopy(value: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  value,
  label = "Copy text",
  className,
  iconSize = "size-3.5",
}: {
  value: string;
  label?: string;
  className?: string;
  iconSize?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function handleCopy(event: React.MouseEvent): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) ok = legacyCopy(value);
    if (ok) {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => void handleCopy(e)}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 active:scale-90",
        copied && "text-emerald-400 hover:text-emerald-300",
        className
      )}
    >
      {copied ? (
        <Check className={iconSize} aria-hidden />
      ) : (
        <Copy className={iconSize} aria-hidden />
      )}
    </button>
  );
}
