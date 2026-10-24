export const CHAT_QUOTATION_STYLE_INSTRUCTION = "【聊天复述】按当前人设、关系和语境直接回应对方的意思，不把逐字摘录、加引号再反问当作固定开场。需要强调、反讽、澄清或讨论具体措辞时，可局部使用引号；其余复述自然融入自己的话。正式引用回复按既有协议使用，不重复抄录卡片原文。";

export const CHAT_QUOTATION_TRANSLATION_INSTRUCTION = "【引文翻译】在自己的回复正文、语音台词或线下对白中复述用户的话时，按语义、语气和关系转成该角色本轮回复的主要表达语言，自然融入表达；无需保留用户原句的语言或引号。真正的人名、品牌保留原文；讨论原词、语言学习或纠正措辞时可按需要保留原词。历史消息、[引用:原文]定位锚点及引用卡片原文保持原样；中文译文仍按既有双语规则输出。";

export function buildChatQuotationInstruction(translationEnabled: boolean | undefined): string {
    return [CHAT_QUOTATION_STYLE_INSTRUCTION, translationEnabled !== false ? CHAT_QUOTATION_TRANSLATION_INSTRUCTION : ""].filter(Boolean).join("\n");
}
