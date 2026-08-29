// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import FilterControlStrip from './FilterControlStrip'
import { useAssetLibraryStore } from './store'

function render(providerOptions: string[] = ['豆包', 'fal']): ReactTestRenderer {
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(<FilterControlStrip providerOptions={providerOptions} />)
  })
  return renderer!
}

beforeEach(() => {
  useAssetLibraryStore.setState({ visibleFilterControls: [], filters: {} })
})

afterEach(() => {
  useAssetLibraryStore.setState({ visibleFilterControls: [], filters: {} })
})

describe('FilterControlStrip（工具栏筛选控件条）', () => {
  it('shows only the add button when no control is enabled', () => {
    const renderer = render()
    expect(renderer.root.findAllByProps({ 'data-testid': 'filter-control-add' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-testid': 'filter-control-provider' })).toHaveLength(0)
    act(() => renderer.unmount())
  })

  it('selects which filter controls to expose via the + menu (自主勾选放出的筛选项)', () => {
    const renderer = render()
    act(() => {
      renderer.root.findByProps({ 'data-testid': 'filter-control-add' }).props.onClick()
    })
    const menu = renderer.root.findByProps({ 'data-testid': 'filter-control-add-menu' })
    expect(menu).toBeTruthy()
    // 勾选「服务商」和「最低评分」
    act(() => {
      renderer.root.findByProps({ 'data-testid': 'filter-control-option-provider' }).props.onClick()
    })
    act(() => {
      renderer.root.findByProps({ 'data-testid': 'filter-control-option-minRating' }).props.onClick()
    })
    expect(useAssetLibraryStore.getState().visibleFilterControls).toEqual(['provider', 'minRating'])
    // 控件出现在工具栏
    act(() => renderer.update(<FilterControlStrip providerOptions={['豆包', 'fal']} />))
    expect(renderer.root.findAllByProps({ 'data-testid': 'filter-control-provider' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-testid': 'filter-control-minRating' })).toHaveLength(1)
    // 取消勾选后控件消失（菜单仍打开，直接取消勾选「服务商」）
    act(() => {
      renderer.root.findByProps({ 'data-testid': 'filter-control-option-provider' }).props.onClick()
    })
    act(() => renderer.update(<FilterControlStrip providerOptions={['豆包', 'fal']} />))
    expect(renderer.root.findAllByProps({ 'data-testid': 'filter-control-provider' })).toHaveLength(0)
    act(() => renderer.unmount())
  })

  it('applies filters directly from the exposed controls (选值即筛选)', () => {
    useAssetLibraryStore.setState({ visibleFilterControls: ['provider', 'model'] })
    const renderer = render()
    // 服务商下拉选值
    const provider = renderer.root.findByProps({ 'data-testid': 'filter-control-provider' })
    act(() => {
      provider.props.onChange({ target: { value: '豆包' } })
    })
    expect(useAssetLibraryStore.getState().filters.provider).toBe('豆包')
    // 模型输入
    const model = renderer.root.findByProps({ 'data-testid': 'filter-control-model' })
    act(() => {
      model.props.onChange({ target: { value: 'gpt-image-1' } })
    })
    expect(useAssetLibraryStore.getState().filters.model).toBe('gpt-image-1')
    // 清空值 → 条件移除
    act(() => {
      provider.props.onChange({ target: { value: '' } })
    })
    expect(useAssetLibraryStore.getState().filters.provider).toBeUndefined()
    act(() => renderer.unmount())
  })

  it('exposes favorite/date/width controls as whole parameter groups', () => {
    useAssetLibraryStore.setState({ visibleFilterControls: ['favoriteOnly', 'dateRange', 'widthRange'] })
    const renderer = render()
    expect(renderer.root.findAllByProps({ 'data-testid': 'filter-control-favoriteOnly' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-testid': 'filter-control-dateFrom' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-testid': 'filter-control-dateTo' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-testid': 'filter-control-minWidth' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-testid': 'filter-control-maxWidth' })).toHaveLength(1)
    // 勾选「仅看收藏」直接应用
    act(() => {
      renderer.root.findByProps({ 'data-testid': 'filter-control-favoriteOnly' }).props.onChange({
        target: { checked: true },
      })
    })
    expect(useAssetLibraryStore.getState().filters.favoriteOnly).toBe(true)
    act(() => renderer.unmount())
  })
})
