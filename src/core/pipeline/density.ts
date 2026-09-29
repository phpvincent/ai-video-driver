/**
 * 章节信息密度计算（TECH-DESIGN §4.3，SPEC-03 子任务 3.5）。
 * 纯确定性计算（红线 1）：模型只提供 terms 列表，密度分档完全由代码推导，
 * 无模型调用、无随机源、无时间依赖。
 */
import { DENSITY } from '../../config';
import type { Density, Section } from '../../types';

/** 术语归一化：trim + 小写（大小写/首尾空白不敏感去重） */
function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

/**
 * 分位数（实现方式：线性插值，即 R-7 / Type 7，与 numpy/pandas 默认一致）：
 * pos = (n-1)*p，落在整数位直接取值，否则在相邻两个排序值间线性插值。
 */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 章节分钟数：(endMs-startMs)/60000；< 0.1 按 0.1 计（短章防除零放大） */
function minutesOf(s: { startMs: number; endMs: number }): number {
  return Math.max((s.endMs - s.startMs) / 60_000, 0.1);
}

/**
 * 计算各章节信息密度（TECH-DESIGN §4.3）：
 * - newTerms[i] = 第 i 章 terms 中未在此前任何章节（含本章内此前出现）出现过的数量；
 * - rate[i] = newTerms[i] / 章节分钟数（分钟数下限 0.1）；
 * - 章节数 ≥ minSectionsForQuantile(4)：按全片 rate 的 P75/P25 分位数分档
 *   （≥P75 → high，≤P25 → low，其余 mid）；
 * - 章节数 < 4：绝对阈值（rate ≥ highNewTermsPerMin(3) → high；rate ≥ 1 → mid，下界 1 为
 *   固定常量，TECH-DESIGN §4.3 未将其配置化；否则 low）。
 * 退化：空输入 → []；单章 → ['mid']（单章无对比意义）；全部 rate=0（无术语）→ 全 low
 * （分位数路径下 P75=P25=0 会把 0 误判为 high，需显式短路）。
 * 返回与输入等长的 Density[]（顺序一一对应）。
 */
export function computeDensity(sections: Array<Omit<Section, 'density'>>): Density[] {
  const n = sections.length;
  if (n === 0) return [];

  // 按章节顺序统计每章新术语数与 rate，维护已见术语集合
  const seen = new Set<string>();
  const rates: number[] = [];
  for (const s of sections) {
    let newTerms = 0;
    for (const term of s.terms) {
      const key = normalizeTerm(term);
      if (!seen.has(key)) {
        newTerms += 1;
        seen.add(key);
      }
    }
    rates.push(newTerms / minutesOf(s));
  }

  // 退化：单章无对比意义 → mid（优先于全零判断，即使该章 rate=0）
  if (n === 1) return ['mid'];

  // 退化：全部 rate=0（无任何术语）→ 全 low
  if (rates.every((r) => r === 0)) return sections.map(() => 'low' as const);

  if (n >= DENSITY.minSectionsForQuantile) {
    // 分位数分档：先判 high（≥P75）再判 low（≤P25），二者相等时 high 优先
    const sorted = [...rates].sort((a, b) => a - b);
    const p75 = quantile(sorted, DENSITY.highQuantile);
    const p25 = quantile(sorted, DENSITY.lowQuantile);
    return rates.map((r) => (r >= p75 ? 'high' : r <= p25 ? 'low' : 'mid'));
  }

  // 绝对阈值分档（< 4 章）
  return rates.map((r) => {
    if (r >= DENSITY.highNewTermsPerMin) return 'high' as const;
    if (r >= 1) return 'mid' as const;
    return 'low' as const;
  });
}

/** computeDensity + 按索引合并，返回补全 density 的完整 Section[]（原字段浅拷贝不变） */
export function attachDensity(sections: Array<Omit<Section, 'density'>>): Section[] {
  const densities = computeDensity(sections);
  return sections.map((s, i) => ({ ...s, density: densities[i] }));
}
