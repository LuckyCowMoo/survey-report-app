import { useMemo, useState } from "react";
import { library } from "../lib/matcher";
import type { LibraryParagraph } from "../types";

interface Props {
  onPick: (paragraph: LibraryParagraph) => void;
  onClose: () => void;
}

export default function LibraryPicker({ onPick, onClose }: Props) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.toLowerCase().trim();
    const filtered = library.photoParagraphs.filter(
      (p) =>
        q === "" ||
        p.topic.toLowerCase().includes(q) ||
        p.group.toLowerCase().includes(q) ||
        p.text.toLowerCase().includes(q)
    );
    const byGroup = new Map<string, LibraryParagraph[]>();
    for (const p of filtered) {
      const list = byGroup.get(p.group) ?? [];
      list.push(p);
      byGroup.set(p.group, list);
    }
    return [...byGroup.entries()];
  }, [query]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <h2>Standard wording</h2>
        <input
          className="search"
          type="search"
          placeholder="Search topics..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="picker-list">
          {groups.map(([group, items]) => (
            <div key={group} className="picker-group">
              <h3>{group}</h3>
              {items.map((p) => (
                <button key={p.id} className="picker-item" onClick={() => onPick(p)}>
                  <strong>{p.topic}</strong>
                  <span>{p.text.slice(0, 110)}...</span>
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && <p className="muted">No matches.</p>}
        </div>
        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
