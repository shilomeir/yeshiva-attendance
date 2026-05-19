import { describe, expect, it } from 'vitest'
import { getModalPortalTarget } from '@/components/admin/modalPortal'

describe('getModalPortalTarget', () => {
  it('uses document.body so fixed admin modals escape glass card containing blocks', () => {
    const body = {}
    const target = getModalPortalTarget({ body } as Document)

    expect(target).toBe(body)
  })

  it('returns null when no document is available', () => {
    expect(getModalPortalTarget(null)).toBeNull()
  })
})
