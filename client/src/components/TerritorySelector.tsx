import { useEffect, useMemo, useRef, useState } from "react";
import type { TerritoryInfo } from "../../../shared/types.js";

interface Props {
  territories: TerritoryInfo[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function TerritorySelector({ territories, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const selectedTerritories = useMemo(
    () =>
      selected
        .map((id) => territories.find((territory) => territory.id === id))
        .filter((territory): territory is TerritoryInfo => Boolean(territory)),
    [selected, territories],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es");
    if (!needle) return territories;
    return territories.filter((territory) =>
      territory.name.toLocaleLowerCase("es").includes(needle),
    );
  }, [search, territories]);

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      if (selected.length === 1) return;
      onChange(selected.filter((current) => current !== id));
      return;
    }
    if (selected.length < 6) onChange([...selected, id]);
  };

  return (
    <div className="territory-control" ref={rootRef}>
      <div className="control-label-row">
        <label id="territory-label">Territorios</label>
        <span>{selected.length}/6</span>
      </div>
      <button
        type="button"
        className="selector-trigger"
        aria-labelledby="territory-label"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{selected.length === 1 ? selectedTerritories[0]?.name : `${selected.length} seleccionados`}</span>
        <span className="selector-chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div className="selector-popover">
          <input
            type="search"
            placeholder="Buscar provincia"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoFocus
          />
          <div className="selector-options" role="group" aria-label="Territorios disponibles">
            {filtered.map((territory) => {
              const checked = selected.includes(territory.id);
              const disabled = !checked && selected.length >= 6;
              return (
                <label
                  key={territory.id}
                  className={disabled ? "option disabled" : "option"}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(territory.id)}
                  />
                  <span>{territory.name}</span>
                  {territory.kind === "country" ? <small>Nacional</small> : null}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="selected-chips" aria-label="Territorios seleccionados">
        {selectedTerritories.map((territory) => (
          <span className="territory-chip" key={territory.id}>
            {territory.name}
            {selected.length > 1 ? (
              <button
                type="button"
                aria-label={`Quitar ${territory.name}`}
                onClick={() => toggle(territory.id)}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}

