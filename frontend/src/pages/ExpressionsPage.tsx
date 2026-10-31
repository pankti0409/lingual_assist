import { Plus, Search, Star, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Dialog } from "@/components/Dialog";
import { ExpressionSheet } from "@/components/ExpressionSheet";
import { ExpressionTile, Pictogram } from "@/components/ExpressionTile";
import { TextField } from "@/components/Field";
import { LiveRegion, Notice } from "@/components/Status";
import { allExpressions, CATEGORIES, categoryOf, CUSTOM_ICON_CHOICES, iconFor, type CategoryId, type Expression } from "@/lib/expressions";
import { useDocumentTitle } from "@/lib/dom";
import { useCalm } from "@/lib/motion";
import { useJourney } from "@/state/journey";
import { usePreferences } from "@/state/preferences";

type View = "favourites" | "yours" | CategoryId;
const MAX_TEXT = 120;

function CreateDialog({ open, onClose, seed }: { open: boolean; onClose: () => void; seed: string }) {
  const { addCustom, toggleFavourite } = usePreferences();
  const { record } = useJourney();
  const [text, setText] = useState(seed);
  const [category, setCategory] = useState<CategoryId>("social");
  const [icon, setIcon] = useState("Star");
  const [fav, setFav] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function save() {
    const t = text.trim();
    if (!t) return setError("Write the words you want to say.");
    if (t.length > MAX_TEXT) return setError(`Keep it to ${MAX_TEXT} characters or fewer.`);
    const e = addCustom({ text: t, category, icon });
    if (fav) toggleFavourite(e.id);
    record("expression-created");
    setText("");
    setError(null);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Create your own expression" description="Saved only in this browser. It is spoken only after you confirm it, like everything else.">
      <TextField label="Words to say" value={text} maxChars={MAX_TEXT} error={error} onChange={(e) => setText(e.target.value)} autoFocus />
      <fieldset className="choices choices--compact">
        <legend className="field__label">Category</legend>
        <div className="choices__row">
          {CATEGORIES.map((c) => (
            <label key={c.id} className={`choice${c.id === category ? " is-selected" : ""}`}>
              <input type="radio" name="custom-cat" value={c.id} checked={c.id === category} onChange={() => setCategory(c.id)} />
              <span className="choice__label">{c.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="icon-pick">
        <legend className="field__label">Picture</legend>
        <div className="icon-pick__row">
          {CUSTOM_ICON_CHOICES.map((name) => {
            const Icon = iconFor(name);
            return (
              <label key={name} className={`icon-pick__item${icon === name ? " is-selected" : ""}`}>
                <input type="radio" name="custom-icon" value={name} checked={icon === name} onChange={() => setIcon(name)} />
                <Icon size={26} aria-hidden />
                <span className="sr-only">{name}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <label className="check-row">
        <input type="checkbox" checked={fav} onChange={(e) => setFav(e.target.checked)} />
        <span>Add to my favourites on Home</span>
      </label>
      <div className="preview-tile" aria-hidden>
        <Pictogram icon={icon} accent={categoryOf(category).accent} />
        <span>{text.trim() || "Your words appear here"}</span>
      </div>
      <div className="actions">
        <Button icon={<Plus size={20} />} onClick={save}>Save expression</Button>
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}

export function ExpressionsPage() {
  useDocumentTitle("Quick expressions");
  const { prefs, toggleFavourite, removeCustom } = usePreferences();
  const calm = useCalm();
  const [view, setView] = useState<View>("favourites");
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<Expression | null>(null);
  const [creating, setCreating] = useState(false);
  const [announce, setAnnounce] = useState("");
  const all = useMemo(() => allExpressions(prefs.customExpressions), [prefs.customExpressions]);
  const q = query.trim().toLowerCase();

  const shown = q
    ? all.filter((e) => e.text.toLowerCase().includes(q) || categoryOf(e.category).label.toLowerCase().includes(q))
    : view === "favourites"
      ? prefs.favourites.map((id) => all.find((e) => e.id === id)).filter((e): e is Expression => !!e)
      : view === "yours"
        ? all.filter((e) => e.custom)
        : all.filter((e) => e.category === view && !e.custom);

  const views: { id: View; label: string; count?: number }[] = [
    { id: "favourites", label: "Favourites", count: prefs.favourites.length },
    ...CATEGORIES.map((c) => ({ id: c.id as View, label: c.label })),
    { id: "yours", label: "Yours", count: prefs.customExpressions.length },
  ];

  function fav(e: Expression) {
    const on = prefs.favourites.includes(e.id);
    toggleFavourite(e.id);
    setAnnounce(on ? `Removed “${e.text}” from favourites.` : `Added “${e.text}” to favourites.`);
  }

  const heading = q ? `Results for “${query.trim()}”` : views.find((v) => v.id === view)!.label;

  return (
    <div className="page expressions">
      <header className="page-head page-head--split">
        <div>
          <p className="eyebrow">Quick expression board</p>
          <h1 className="display-2">Say it in a tap.</h1>
          <p className="lede">Choose a tile, check the words, then confirm. Star the ones you use most to keep them on Home.</p>
        </div>
        <div className="board-tools">
          <div className="search">
            <Search size={20} aria-hidden className="search__icon" />
            <label htmlFor="x-search" className="sr-only">Search expressions</label>
            <input id="x-search" type="search" className="search__input" placeholder="Search expressions" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && (
              <button type="button" className="icon-btn search__clear" aria-label="Clear search" onClick={() => setQuery("")}>
                <X size={18} aria-hidden />
              </button>
            )}
          </div>
          <Button icon={<Plus size={20} />} onClick={() => setCreating(true)}>Create your own</Button>
        </div>
      </header>

      <fieldset className="cat-rail" disabled={!!q}>
        <legend className="sr-only">Expression category</legend>
        {views.map((v) => {
          const cat = CATEGORIES.find((c) => c.id === v.id);
          const Icon = v.id === "favourites" ? Star : v.id === "yours" ? Plus : cat!.icon;
          return (
            <label key={v.id} className={`cat-chip cat-chip--${cat?.accent ?? "teal"}${view === v.id && !q ? " is-on" : ""}`}>
              <input type="radio" name="x-view" value={v.id} checked={view === v.id} onChange={() => setView(v.id)} />
              <Icon size={18} aria-hidden />
              <span>{v.label}</span>
              {v.count !== undefined && <span className="cat-chip__count">{v.count}</span>}
            </label>
          );
        })}
      </fieldset>

      <section aria-labelledby="board-h" className="board">
        <h2 id="board-h" className="h3 board__title">{heading}</h2>
        {view === "emergency" && !q && (
          <Notice tone="warning" title="These tiles say the words aloud — they do not call anyone.">
            Lingual Assist cannot contact emergency services or a carer. Keep your usual alarm or phone within reach.
          </Notice>
        )}
        {shown.length ? (
          <ul className="board-grid">
            <AnimatePresence initial={false}>
              {shown.map((e) => (
                <motion.li key={e.id} layout={!calm} initial={calm ? false : { opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }} transition={{ duration: 0.2 }}>
                  <ExpressionTile expression={e} favourite={prefs.favourites.includes(e.id)} onSay={setSheet} onFavourite={fav} />
                  {e.custom && (
                    <button type="button" className="tile-remove" onClick={() => removeCustom(e.id)} aria-label={`Delete your expression “${e.text}”`}>
                      <Trash2 size={16} aria-hidden /> Delete
                    </button>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <div className="empty-block">
            {q ? (
              <>
                <p className="empty-block__title">Nothing matches “{query.trim()}”.</p>
                <p className="muted">You can make it one of your own expressions.</p>
                <Button icon={<Plus size={20} />} onClick={() => setCreating(true)}>Create “{query.trim().slice(0, 40)}”</Button>
              </>
            ) : view === "favourites" ? (
              <>
                <p className="empty-block__title">No favourites yet.</p>
                <p className="muted">Press the star on any tile to keep it here and on Home.</p>
              </>
            ) : (
              <>
                <p className="empty-block__title">You haven’t made any expressions yet.</p>
                <p className="muted">Add the phrases you use every day — names, places, little jokes.</p>
                <Button icon={<Plus size={20} />} onClick={() => setCreating(true)}>Create your own</Button>
              </>
            )}
          </div>
        )}
      </section>

      <CreateDialog key={creating ? `open-${q}` : "closed"} open={creating} onClose={() => setCreating(false)} seed={q ? query.trim() : ""} />
      <ExpressionSheet expression={sheet} onClose={() => setSheet(null)} />
      <LiveRegion message={announce} />
    </div>
  );
}
