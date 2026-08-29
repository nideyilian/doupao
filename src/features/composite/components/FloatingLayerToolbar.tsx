import { CircleIcon as Circle, DiamondIcon as Diamond, ImageIcon, TypeIcon as Type } from '../../../design-system/icons'
import type { ReactNode } from 'react'
import ViewportTooltip from '../../../components/ViewportTooltip'
import { useTooltip } from '../../../hooks/useTooltip'

type Props = {
  onAddText: () => void
  onAddImage: () => void
  onAddLogo: () => void
  disabled?: boolean
}
type ButtonProps = {
  tooltip: string
  ariaLabel: string
  disabled?: boolean
  onClick?: () => void
  icon: ReactNode
  label: string
}

function ToolButton({ tooltip, ariaLabel, disabled = false, onClick, icon, label }: ButtonProps) {
  const tooltipState = useTooltip()
  return (
    <span className="relative inline-flex" {...tooltipState.handlers}>
      <button
        type="button"
        aria-label={ariaLabel}
        title={tooltip}
        disabled={disabled}
        onClick={() => {
          tooltipState.dismiss()
          onClick?.()
        }}
        className={`flex h-ds-control-lg w-full items-center gap-2 px-3 border-b border-ds-border text-sm font-medium transition last:border-b-0 dark:border-ds-border ${disabled ? 'cursor-not-allowed text-ds-text-subtle dark:text-ds-muted' : 'text-ds-text hover:bg-ds-primary-subtle hover:text-ds-primary dark:text-ds-text-subtle'}`}
      >
        {icon}
        <span>{label}</span>
      </button>
      <ViewportTooltip visible={tooltipState.visible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

export function FloatingLayerToolbar({ onAddText, onAddImage, onAddLogo, disabled = false }: Props) {
  return (
    <div className="absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col overflow-hidden rounded-md border border-ds-border bg-ds-surface/95 shadow-lg backdrop-blur dark:border-ds-border dark:bg-ds-scrim/90">
      <ToolButton
        tooltip={disabled ? '请先选择预设以添加文字图层' : '添加文字图层'}
        ariaLabel={disabled ? '未选择预设时无法添加文字图层' : '添加文字图层'}
        disabled={disabled}
        onClick={onAddText}
        icon={<Type className="h-4 w-4" />}
        label="文字"
      />
      <ToolButton
        tooltip={disabled ? '请先选择预设以添加图片图层' : '添加图片图层'}
        ariaLabel={disabled ? '未选择预设时无法添加图片图层' : '添加图片图层'}
        disabled={disabled}
        onClick={onAddImage}
        icon={<ImageIcon className="h-4 w-4" />}
        label="图片"
      />
      <ToolButton
        tooltip={disabled ? '请先选择预设以添加LOGO图层' : '添加LOGO图层'}
        ariaLabel={disabled ? '未选择预设时无法添加LOGO图层' : '添加LOGO图层'}
        disabled={disabled}
        onClick={onAddLogo}
        icon={<ImageIcon className="h-4 w-4" />}
        label="LOGO"
      />
      <ToolButton
        tooltip="形状图层后续支持"
        ariaLabel="形状图层后续支持"
        disabled
        onClick={() => {}}
        icon={<Diamond className="h-4 w-4" />}
        label="形状"
      />
    </div>
  )
}
