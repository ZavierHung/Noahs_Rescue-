# 本地插画素材

2026-09-19 使用内置 **image_gen** 生成，两张各一次请求，无 CLI/API Key，无重试。原图 1536 × 1024；通过本地 `sips` 等比例缩至 900 × 600 并转 JPEG（质量 78），用于本项目。未将图像内容、角色人设或模型提示词嵌入业务逻辑。

| 素材 | 原生小程序路径 | 网页路径 | 大小 |
| --- | --- | --- | --- |
| 方舟六位伙伴 | `miniprogram/assets/ark-companions.jpg` | `app/public/images/ark-companions.jpg` | 217,262 B |
| 森林神谕圣殿 | `miniprogram/assets/oracle-sanctuary.jpg` | `app/public/images/oracle-sanctuary.jpg` | 270,029 B |

第一张用于角色确认页，六个角色对应三位动物及船长、商人、猎人。第二张用于游戏神谕区域，以自然景观表达氛围，不声称画中树木是当前随机选中的某位上帝。界面文字仍由真实游戏数据呈现，不放进图片。

## 完整生成提示词：方舟

```text
Use case: illustration-story
Asset type: standalone polished game scene artwork for a compact mobile role/start banner; landscape 3:2 aspect ratio.
Scene/backdrop: a wooden ark floating on calm green water, simple serene ecological landscape.
Subject: exactly SIX friendly companions clearly visible together on the open deck, each with a separate readable silhouette: one fennec fox with huge ears, one golden lion tamarin monkey with orange mane and long tail, one white polar bear, one human captain in blue with a nautical hat, one human merchant with a modest satchel, one human hunter in green with a lowered wooden bow. The animals and humans feel like equal teammates on a welcoming cooperative ecological board-game adventure.
Style/medium: richly polished storybook gouache illustration, softly textured paper, confident hand-painted shapes, charming expressive faces, restrained detail that remains legible at small mobile size.
Composition/framing: wide 3:2 canvas, ark and the six companions form one large central focal group; full boat visible with breathing room; slightly elevated three-quarter view so every companion is visible on deck. Keep faces and character silhouettes distinct from each other.
Lighting/mood: warm gentle daylight, welcoming and hopeful.
Color palette: warm cream #F6F3EA, deep forest green #234D40, muted gold, restrained blue accents.
Constraints: exactly the six named companions; no additional people or animals; all six on the deck. Standalone full-bleed scene illustration, no interface mockup, no text, no letters, no UI, no logos, no watermark.
```

## 完整生成提示词：神谕

```text
Use case: illustration-story
Asset type: standalone polished game scene artwork for a compact mobile oracle card; landscape 3:2 aspect ratio.
Scene/backdrop: sacred forest oracle sanctuary surrounding a luminous ancient tree, calm reflective water below, broad branching canopy forming a sheltering natural arch.
Subject: the luminous tree is the central focal point, with a subtle muted gold sun disc behind its branches and a softly glowing reflection in the water. Suggest a quiet mysterious ecological deity presence through light and nature alone, suitable for randomly chosen deity personas.
Style/medium: richly polished storybook gouache illustration, softly textured paper, confident hand-painted shapes, restrained detail legible at small mobile size. Cohesive visual language of a welcoming cooperative ecological board game.
Composition/framing: wide 3:2 canvas, a strong central tree silhouette, curved roots embracing the water, canopy occupying the upper frame, balanced uncluttered environment.
Lighting/mood: tranquil, sacred, mysterious, gentle luminous atmosphere.
Color palette: warm cream #F6F3EA, deep forest green #234D40, muted gold, restrained blue accents.
Constraints: no specific god portrait, no faces, no characters, no people, no animals. Standalone full-bleed scene illustration, no interface mockup, no text, no letters, no UI, no logos, no watermark.
```

迭代时保留业务按钮、无障碍文字和状态提示，不将图片当作交互控件。更新两端素材后运行 `npm test` 校验文件一致性及体积，再运行 `npm run test:quick` 检查真实图片加载与手机布局。
