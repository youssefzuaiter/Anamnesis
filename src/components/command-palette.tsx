"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { quickSearchAction } from "@/actions/search";
import type { SearchHit } from "@/repositories/search-repository";

type Command = {
  id: string;
  kind: SearchHit["kind"] | "action";
  title: string;
  detail: string | null;
  href: string;
};

const NAVIGATION: Command[] = [
  { id: "new-note", kind: "action", title: "New note", detail: "Create", href: "/notes/new" },
  { id: "go-notes", kind: "action", title: "Notes", detail: "Go to", href: "/notes" },
  { id: "go-tasks", kind: "action", title: "Tasks", detail: "Go to", href: "/tasks" },
  { id: "go-calendar", kind: "action", title: "Calendar", detail: "Go to", href: "/calendar" },
  { id: "go-projects", kind: "action", title: "Projects", detail: "Go to", href: "/projects" },
  { id: "go-goals", kind: "action", title: "Goals", detail: "Go to", href: "/goals" },
  { id: "go-ai", kind: "action", title: "Assistant", detail: "Go to", href: "/ai" },
  { id: "go-home", kind: "action", title: "Dashboard", detail: "Go to", href: "/" },
];

// "course" and "goal" are part of Command["kind"] only because they share
// SearchHit's type with the semantic /search page — quickSearch itself never
// returns either, so these entries are dead in practice but keep the Record
// exhaustive.
const KIND_LABELS: Record<Command["kind"], string> = {
  action: "Go",
  note: "Note",
  task: "Task",
  event: "Event",
  project: "Project",
  course: "Course",
  goal: "Goal",
};

const DEBOUNCE_MS = 150;
const MIN_QUERY = 2;

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Guards against a slow early request overwriting a newer one's results.
  const requestId = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setActive(0);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((wasOpen) => !wasOpen);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) return;

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const response = await quickSearchAction(trimmed);
      if (id !== requestId.current) return;
      setHits(response.success ? response.data : []);
      setSearching(false);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  // Resetting selection and clearing stale hits belongs to the input event, not
  // to an effect — React 19 flags synchronous setState inside effect bodies.
  function onQueryChange(value: string) {
    setQuery(value);
    setActive(0);

    if (value.trim().length < MIN_QUERY) {
      requestId.current++;
      setHits([]);
      setSearching(false);
    } else {
      setSearching(true);
    }
  }

  const filteredNavigation = NAVIGATION.filter((command) =>
    command.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const commands: Command[] = [
    ...hits.map((hit) => ({
      id: hit.id,
      kind: hit.kind,
      title: hit.title,
      detail: hit.detail,
      href: hit.href,
    })),
    ...filteredNavigation,
  ];

  // Results can shrink under the cursor between keystrokes.
  const activeIndex =
    commands.length === 0 ? 0 : Math.min(active, commands.length - 1);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function go(command: Command) {
    close();
    router.push(command.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (commands.length === 0 ? 0 : (i + 1) % commands.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) =>
        commands.length === 0 ? 0 : (i - 1 + commands.length) % commands.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = commands[activeIndex];
      if (command) go(command);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-[var(--shadow)]"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Search notes, tasks, events, projects…"
          aria-label="Search or jump to"
          className="w-full border-b border-border-subtle bg-transparent px-4 py-3.5 text-sm text-text placeholder:text-text-faint focus:outline-none"
        />

        <ul ref={listRef} className="max-h-80 overflow-y-auto py-1.5">
          {commands.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-text-muted">
              {searching
                ? "Searching…"
                : query.trim().length < MIN_QUERY
                  ? "Type to search your workspace."
                  : `Nothing matched “${query.trim()}”.`}
            </li>
          ) : (
            commands.map((command, index) => (
              <li key={`${command.kind}-${command.id}`}>
                <button
                  type="button"
                  data-active={index === activeIndex}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(command)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                    index === activeIndex ? "bg-surface-raised" : ""
                  }`}
                >
                  <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-text-faint">
                    {KIND_LABELS[command.kind]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-text">
                    {command.title}
                  </span>
                  {command.detail && (
                    <span className="max-w-40 shrink-0 truncate text-xs text-text-faint">
                      {command.detail}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
