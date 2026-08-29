import { describe, expect, it } from 'vitest'
import { formatElementPoolForPrompt, parseElementPool } from './elementPool'

const REAL_SOP = `### ⚙️ Role & Goal
你是一个针对【快手爆款美食吃播信息流广告】的提示词生成专家。

### 📦 动态变体元素池 (Element Pool)

* **[层级一：动态文案与标题概念变体]**：
1. 粗体描边大标题"吃货de快乐时刻"，搭配黄色胶囊副标"登录解锁海量美食"与底部搜索栏
2. 潮流爆炸框主标"九宫格全开，根本停不住"，搭配醒目行动按钮"看TA全吃完"
3. 霸气书法飞白文案"这口，外地人看了都得咽口水"，搭配"震惊+挑战"红色角标

* **[层级二：核心视觉焦点 / 主体概念变体]**：
1. 戴黑框眼镜的年轻女主播，正手持叉子大口吞咽浓郁裹汁的火鸡面与爆辣年糕
2. 3D可爱外卖员IP形象，单手托举热气腾腾的溏心蛋拉面碗，另一手展示手机直播界面
3. 热情主播双手悬空倾倒超长拉丝芝士瀑布与黑糖珍珠巨型奶茶杯

* **[层级三：场景与环境基底变体]**：
1. 暖橙色高饱和电商营销背景板，带有微弱波普射线与渐变光影
2. 喜庆红火的国潮直播间背景，挂满小红灯笼与福字新年装饰
3. 极简深色高级暗调背景，带有橙红色放射状动感光效与霓虹点缀

* **[层级四：氛围与细节装饰变体]**：
1. 悬浮的3D大拇指点赞图标、飘浮爱心气泡与Q版对话框
2. 底部快手搜索框组件、放大镜图标与小巧可爱的黄色小鸟立体模型
3. 食材表面晶莹剔透的高光油滴、飞溅的红色辣椒油微粒与腾腾热气

### 🤖 运行机制与严格输出模板
当用户向你输入"生成 N 条提示词"时，严格按照以下 JSON 格式输出`

describe('parseElementPool', () => {
  it('detects the layered element pool from the real SOP structure', () => {
    const result = parseElementPool(REAL_SOP)
    expect(result.detected).toBe(true)
    expect(result.levels).toHaveLength(4)
    expect(result.levels[0].key).toBe('层级一')
    expect(result.levels[0].title).toContain('动态文案与标题概念变体')
    expect(result.levels[0].items).toHaveLength(3)
    expect(result.levels[0].items[0]).toContain('吃货de快乐时刻')
    expect(result.levels[1].items[1]).toContain('3D可爱外卖员')
    expect(result.levels[2].items[2]).toContain('极简深色高级暗调背景')
    expect(result.levels[3].items[0]).toContain('3D大拇指点赞图标')
  })

  it('stops collecting items when the section ends with plain text', () => {
    const result = parseElementPool(`* **[层级一：文案变体]**：
1. 标题A
2. 标题B

之后的正文说明不属于元素池

* **[层级二：主体变体]**：
1. 主体A`)
    expect(result.detected).toBe(true)
    expect(result.levels).toHaveLength(2)
    expect(result.levels[0].items).toHaveLength(2)
    expect(result.levels[1].items).toHaveLength(1)
  })

  it('supports heading and item format variants', () => {
    const result = parseElementPool(`### Level 1: 文案
- 文案A
- 文案B

### 层级2：场景
（1）场景A
（2）场景B`)
    expect(result.detected).toBe(true)
    expect(result.levels[0].key).toBe('Level 1')
    expect(result.levels[0].items).toEqual(['文案A', '文案B'])
    expect(result.levels[1].key).toBe('层级2')
    expect(result.levels[1].items).toEqual(['场景A', '场景B'])
  })

  it('does not detect a single heading as an element pool', () => {
    const result = parseElementPool(`# 普通 SOP

1. 第一步
2. 第二步
3. 验收`)
    expect(result.detected).toBe(false)
    expect(result.levels).toHaveLength(0)
  })

  it('does not detect plain numbered lists without level headings', () => {
    const result = parseElementPool(`1. 生成提示词
2. 审核提示词
3. 提交生图`)
    expect(result.detected).toBe(false)
  })
})

describe('formatElementPoolForPrompt', () => {
  it('renders the pool as a compact reference for AI instructions', () => {
    const result = parseElementPool(REAL_SOP)
    const text = formatElementPoolForPrompt(result)
    expect(text).toContain('层级一')
    expect(text).toContain('- 粗体描边大标题')
    expect(text).toContain('层级四')
    expect(text.split('\n\n').length).toBe(4)
  })

  it('returns empty text when no pool is detected', () => {
    expect(formatElementPoolForPrompt(parseElementPool('# 普通 SOP'))).toBe('')
  })
})
