import type { PluginSearchResult } from '../../shared/ipc'

const NPM_SEARCH_API = 'https://registry.npmjs.org/-/v1/search'

interface NpmSearchResponse {
  objects?: Array<{
    package: {
      name: string
      version: string
      description?: string
      author?: { name?: string } | string
      keywords?: string[]
    }
  }>
}

/**
 * npm registry 搜索：优先匹配 dsh-plugin 生态（关键词/官方 scope），
 * 返回给插件管理页的搜索结果。
 */
export async function searchPlugins(query: string, size = 20): Promise<PluginSearchResult[]> {
  try {
    const url = `${NPM_SEARCH_API}?text=${encodeURIComponent(query)}&size=${size}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    clearTimeout(timer)
    if (!res.ok) return []
    const data = (await res.json()) as NpmSearchResponse
    return (data.objects ?? []).map((o) => ({
      name: o.package.name,
      version: o.package.version,
      description: o.package.description,
      author: typeof o.package.author === 'string' ? o.package.author : o.package.author?.name,
      // 关键词含 dsh-plugin / cordis 的优先标记为插件候选
      isBundle: o.package.keywords?.some((k) => /dsh|harness|cordis/i.test(k)) ?? false
    }))
  } catch {
    return []
  }
}

/** 查询单个包的元数据（含 dist-tags.latest） */
export async function packageMeta(name: string): Promise<{ latest?: string; description?: string } | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = (await res.json()) as { 'dist-tags'?: { latest?: string }; description?: string }
    return { latest: data['dist-tags']?.latest, description: data.description }
  } catch {
    return null
  }
}
