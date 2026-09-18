import re

filepath = r"d:\my-web-os\src\components\OrderRecognitionModule.tsx"

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update ParsedResult
old_parsed_result = """    match_1: MatchResult;
    match_2: MatchResult;
    match_3: MatchResult;
}"""
new_parsed_result = """    match_1: MatchResult;
    match_2: MatchResult;
    match_3: MatchResult;
    user_corrected?: boolean;
    corrected_match?: MatchResult;
}"""
content = content.replace(old_parsed_result, new_parsed_result)


# 2. Update MaterialResultCard props
old_props = """    onToggle: () => void;
    baseCopperPrice: number;
    onOpenCustomerProfile: (profile: CustomerRiskProfile, matNo: string, spec: string) => void;
}) => {"""
new_props = """    onToggle: () => void;
    baseCopperPrice: number;
    onOpenCustomerProfile: (profile: CustomerRiskProfile, matNo: string, spec: string) => void;
    onMatchChange?: (match: MatchResult, isCorrection: boolean) => void;
}) => {"""
content = content.replace(old_props, new_props)

# 3. Add useEffect to MaterialResultCard
old_effect_target = """    const rawMatch = activeMatch === 4 && customMatch
        ? customMatch
        : item[`match_${activeMatch}` as keyof ParsedResult] as MatchResult;"""
new_effect = """    const rawMatch = activeMatch === 4 && customMatch
        ? customMatch
        : item[`match_${activeMatch}` as keyof ParsedResult] as MatchResult;

    useEffect(() => {
        if (onMatchChange && rawMatch) {
            onMatchChange(rawMatch, activeMatch !== 1);
        }
    }, [activeMatch, customMatch]);"""
content = content.replace(old_effect_target, new_effect)


# 4. Update where MaterialResultCard is called in OrderRecognitionModule
old_card_call = """                            {parsedList.map((item, idx) => (
                                <MaterialResultCard
                                    key={idx}
                                    item={item}
                                    idx={idx}
                                    isExpanded={!!expandedItems[idx]}
                                    onToggle={() => handleToggleItem(idx)}
                                    baseCopperPrice={baseCopperPrice}
                                    onOpenCustomerProfile={openCustomerProfile}
                                />
                            ))}"""
new_card_call = """                            {parsedList.map((item, idx) => (
                                <MaterialResultCard
                                    key={idx}
                                    item={item}
                                    idx={idx}
                                    isExpanded={!!expandedItems[idx]}
                                    onToggle={() => handleToggleItem(idx)}
                                    baseCopperPrice={baseCopperPrice}
                                    onOpenCustomerProfile={openCustomerProfile}
                                    onMatchChange={(match, isCorrection) => {
                                        setParsedList(prev => {
                                            if (!prev) return prev;
                                            const newList = [...prev];
                                            newList[idx] = { 
                                                ...newList[idx], 
                                                user_corrected: isCorrection, 
                                                corrected_match: match 
                                            };
                                            return newList;
                                        });
                                    }}
                                />
                            ))}"""
content = content.replace(old_card_call, new_card_call)

# 5. Update handleSyncERP
old_sync_body = """                        items: parsedList.map(item => ({
                            material_no: item.material_no,
                            qty: item.length_m || 1000,
                            unit_price: Number(item.unit_price)
                        }))"""
new_sync_body = """                        items: parsedList.map(item => ({
                            material_no: (item.corrected_match ? item.corrected_match.material_no : item.material_no),
                            qty: item.length_m || 1000,
                            unit_price: Number(item.unit_price)
                        }))"""
content = content.replace(old_sync_body, new_sync_body)


# 6. Add memory sync logic inside handleSyncERP
old_sync_success = """                const data = await res.json();
                if (data.success && data.orderId) {
                    setErpOrderId(data.orderId);
                } else {"""
new_sync_success = """                const data = await res.json();
                
                // 同步纠错记忆库
                const correctedItems = parsedList.filter(item => item.user_corrected && item.corrected_match);
                for (const item of correctedItems) {
                    try {
                        await fetchWithAuth('/api/order-recognition/memory', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                customerName: item.customer_name || '未知客户',
                                ocrName: item.material_recognize || item.material_no,
                                materialNo: item.corrected_match!.material_no,
                                materialName: item.corrected_match!.material_match,
                                materialSpec: item.corrected_match!.material_spec
                            })
                        });
                    } catch (e) {
                        console.error('保存记忆库失败', e);
                    }
                }

                if (data.success && data.orderId) {
                    setErpOrderId(data.orderId);
                } else {"""
content = content.replace(old_sync_success, new_sync_success)


with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Modification complete.")
