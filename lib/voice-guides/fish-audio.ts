// Adapted from Fish's emotion-control docs and S2 inline-direction guide.
// References and implementation notes live in docs/fish-audio-voice.md, not the prompt.
export function fishAudioVoiceInstruction(characterIds: string[], call = false): string {
    return `【语音表达·Fish Audio】仅适用于Fish Audio角色ID：${characterIds.join("、")}；各角色只使用自己供应商的表达规则。
按各自人设、关系、上下文和台词意图选择说话方式，承接仍在持续的情绪；同一种情绪可有不同强度或混合感受，不机械套用表演。
用简短自然语言描述能听到的情绪、音量、节奏或声音。标记放在它开始影响的词句之前；整句情绪通常放句首，局部语气可放句中，到下一标记或句末结束。描述性语气标记后要有对应台词，不单独输出没有台词的说话方式。
按台词意图分别选择情绪、说话方式和实际发声；一个标记表达一个清晰方向，组合时使用相邻的独立标记，如{voice:happy}{voice:soft tone}。笑声、叹息等单独标注在发生处，如{voice:chuckling}，不与音色、情绪混成形容词列表。音色沿用绑定声音，不靠反复要求低哑、沙砾感代替语气。
自然对白可以不加标记；需要明确表达时选择准确方向，在情绪或说话方式转折处局部标注，不用一个笼统的温柔描述覆盖整段。优先表达当前主要情绪，需要时组合少量相容的情绪与发声方式；不堆叠冲突指令，不在短句中反复切换，不机械添加笑声、叹息或停顿。按真实表达意图保持台词与语气一致。
情绪参考：happy开心；excited兴奋；sad难过；angry生气；calm平静；nervous紧张；confident自信；worried担心；frustrated烦躁；curious好奇；surprised惊讶；sarcastic讽刺；embarrassed尴尬；disappointed失望；hopeful期待；resigned无奈。
语气参考：whispering耳语；soft tone轻声；shouting喊叫；in a hurry tone急促；emphasis重读；可用slightly sad、very excited等简短描述控制强弱，也可描述更细的复合语气，不限于参考词。
声音参考：laughing笑声；chuckling轻笑；sobbing抽泣；sighing叹息；groaning低哼；panting喘息；gasping倒吸气；yawning哈欠；clear throat清嗓。声音只放在实际发生处；不为制造效果凭空增加台词。停顿可用标点，必要时用break短停顿、long-break长停顿。背景声按已建立场景选择，如background laughter、rustling sound，不写心理旁白或不可听的动作。
格式：{voice:简短英文指令}，每个标记不超过100个英文字符，仅用英文字母、空格、逗号、连字符和英文单引号，不嵌套方括号，不含竖线。标记不翻译、不在译文中重复；台词保留既有语言与双语格式。${call ? "当前为通话，在口述正文内标注，不改成语音条。" : "只在 [语音条:内容] 内标注，如 [语音条:{voice:chuckling} 原来是你。]；普通文字不加。"}
只输出既有消息协议要求的内容，不输出标签解释或判断过程。`;
}
