import { useStore } from '../store'
import { clearFailedTasks } from '../store'
import Select from './Select'
import { FavoriteIcon, CollectionManageIcon, TrashIcon } from './icons'
import { IconButton, SearchField, Toolbar } from '../design-system'

export default function SearchBar() {
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const openManageCollectionsModal = useStore((s) => s.openManageCollectionsModal)
  const hasFailedTasks = useStore((s) => s.tasks.some((t) => t.status === 'error'))

  const handleFavoriteClick = () => {
    setFilterFavorite(!filterFavorite)
  }

  return (
    <div
      data-no-drag-select
      role="search"
      aria-label="画廊筛选"
      className="gallery-toolbar mt-6 mb-4 flex flex-col gap-3 sm:flex-row"
    >
      <Toolbar label="画廊筛选操作" className="flex-shrink-0 z-20">
        <IconButton
          size="lg"
          onClick={handleFavoriteClick}
          aria-label={filterFavorite ? '退出收藏夹视图' : '打开收藏夹'}
          aria-pressed={filterFavorite}
          className="gallery-toolbar__icon"
          data-active={filterFavorite || undefined}
          title={filterFavorite ? '退出收藏夹视图' : '收藏夹'}
          icon={<FavoriteIcon filled={filterFavorite} className="h-5 w-5" />}
        />
        {filterFavorite && (
          <IconButton
            size="lg"
            onClick={openManageCollectionsModal}
            aria-label="管理收藏夹"
            className="gallery-toolbar__icon"
            title="管理收藏夹"
            icon={<CollectionManageIcon className="h-5 w-5" />}
          />
        )}
        {filterFavorite && (
          <div className="relative w-28">
            <Select
              value={filterStatus}
              ariaLabel="筛选任务状态"
              onChange={(val) => setFilterStatus(val as 'all' | 'running' | 'done' | 'error')}
              options={[
                { label: '全部状态', value: 'all' },
                { label: '已完成', value: 'done' },
                { label: '生成中', value: 'running' },
                { label: '失败', value: 'error' },
              ]}
              className="gallery-status-select"
            />
          </div>
        )}
        {filterFavorite && hasFailedTasks && (
          <IconButton
            size="lg"
            onClick={clearFailedTasks}
            aria-label="清除失败记录"
            className="gallery-toolbar__icon gallery-toolbar__icon--danger"
            title="清除失败记录"
            icon={<TrashIcon className="h-5 w-5" />}
          />
        )}
      </Toolbar>
      {filterFavorite && (
        <div className="relative z-10 flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <div className="min-w-[12rem] flex-1">
            <SearchField
              label="搜索任务"
              value={searchQuery}
              onChange={setSearchQuery}
              onClear={() => setSearchQuery('')}
              placeholder="搜索提示词、参数..."
            />
          </div>
          <div
            id="gallery-layout-controls"
            className="gallery-layout-controls ml-auto flex min-w-0 items-center empty:hidden max-xl:ml-0 max-xl:w-full"
          />
        </div>
      )}
    </div>
  )
}
