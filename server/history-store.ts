import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  HistoryManifest,
  TerritorySeries,
} from "../shared/types.js";

export class HistoryStore {
  private readonly directory: string;
  private manifestCache: HistoryManifest | null = null;
  private readonly seriesCache = new Map<string, TerritorySeries>();

  constructor(directory: string) {
    this.directory = directory;
  }

  async getManifest(): Promise<HistoryManifest> {
    if (this.manifestCache) return this.manifestCache;
    const contents = await readFile(resolve(this.directory, "manifest.json"), "utf8");
    this.manifestCache = JSON.parse(contents) as HistoryManifest;
    return this.manifestCache;
  }

  async getTerritories(ids: string[]): Promise<TerritorySeries[]> {
    return Promise.all(ids.map((id) => this.getTerritory(id)));
  }

  private async getTerritory(id: string): Promise<TerritorySeries> {
    const cached = this.seriesCache.get(id);
    if (cached) return cached;
    const contents = await readFile(resolve(this.directory, `${id}.json`), "utf8");
    const series = JSON.parse(contents) as TerritorySeries;
    this.seriesCache.set(id, series);
    return series;
  }
}

