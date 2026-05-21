class SolarExportCalculator {
  static calculateMonthlyCredit(units, tariffTemplate, monthKey) {
    if (!units || units <= 0) return 0;
    if (!tariffTemplate) return 0;

    const state = (tariffTemplate._id || 'tamil-nadu').toLowerCase();
    let cost = 0;
    let selectedSlabs = null;

    // --- 1. DATE-BASED AND CONDITIONAL PROGRESSIVE LOGIC (TAMIL NADU) ---
    if (tariffTemplate.type === "date_based_progressive" && Array.isArray(tariffTemplate.billingRules)) {
      
      const matchedRule = tariffTemplate.billingRules.find(rule => {
        // Clean dates down to YYYY-MM format to prevent string length mismatch drops
        const cleanTarget = monthKey.slice(0, 7); // "2026-05"
        
        if (rule.effectiveTo) {
          const cleanTo = rule.effectiveTo.slice(0, 7);
          if (cleanTarget > cleanTo) return false;
        }
        
        if (rule.effectiveFrom) {
          const cleanFrom = rule.effectiveFrom.slice(0, 7);
          if (cleanTarget < cleanFrom) return false;
        }

        // Check conditional boundaries safely
        if (rule.condition) {
          if (rule.condition.maxUnits && units > rule.condition.maxUnits) return false;
          if (rule.condition.minUnits && units < rule.condition.minUnits) return false;
        }
        return true;
      });

      if (matchedRule) {
        selectedSlabs = matchedRule.slabs;
        console.log(`🎯 [Tariff Engine Success]: Found matching rule array style "${matchedRule.type}" for ${monthKey}`);
      } else {
        console.log(`⚠️ [Tariff Engine Alert]: No matching rule found for month ${monthKey} with ${units} units`);
      }
    }

    // --- 2. KERALA LOGIC ---
    if (state === 'kerala') {
      const slabs = tariffTemplate.slabs;
      const telescopic = slabs?.telescopic_up_to_250 || [];
      const nonTelescopic = slabs?.non_telescopic_above_250 || [];

      let threshold = 250;
      if (telescopic.length > 0) {
        const lastSlab = telescopic[telescopic.length - 1];
        threshold = (lastSlab.to === null) ? Infinity : Number(lastSlab.to);
      }

      if (units <= threshold) {
        let remaining = units;
        for (const slab of telescopic) {
          if (remaining <= 0) break;
          
          const slabStart = Number(slab.from || 0);
          const slabEnd = (slab.to === null) ? Infinity : Number(slab.to);
          const slabCapacity = slabEnd === Infinity ? remaining : (slabEnd - slabStart); 
          const slabUnits = Math.min(remaining, slabCapacity);
          
          cost += slabUnits * Number(slab.rate);
          remaining -= slabUnits;
        }
      } else {
        let flatRate = 9.20; 
        const matchedSlab = nonTelescopic.find(slab => {
          const from = Number(slab.from || 0);
          const to = (slab.to === null) ? Infinity : Number(slab.to);
          return units >= from && units <= to;
        });

        if (matchedSlab) flatRate = Number(matchedSlab.rate);
        cost = units * flatRate;
      }
    } 
    // --- 3. STANDARD PROGRESSIVE CEILING BOUNDARY LOOP (TAMIL NADU) ---
    else {
      const slabsArray = selectedSlabs || tariffTemplate.slabs || [];
      const sortedSlabs = [...slabsArray].sort((a, b) => Number(a.from) - Number(b.from));
      let remaining = units;

      for (const slab of sortedSlabs) {
        if (remaining <= 0) break;

        const slabStart = Number(slab.from || 0);
        const slabEnd = (slab.to === null || slab.to === undefined) ? Infinity : Number(slab.to);

        const slabCapacity = (slabEnd === Infinity) ? remaining : (slabEnd - slabStart + 1);
        const slabUnits = Math.min(remaining, slabCapacity);

        if (slabUnits > 0) {
          const slabRate = Number(slab.rate || 0);
          cost += slabUnits * slabRate;
          remaining -= slabUnits;
          
          if (monthKey === "2026-05") {
            console.log(`   ├─► Slab [${slabStart} to ${slab.to || '∞'}]: Processed ${slabUnits.toFixed(2)} units @ ₹${slabRate} = +₹${(slabUnits * slabRate).toFixed(2)}`);
          }
        }
      }
    }

    const fixedCharge = tariffTemplate.fixedCharges?.single_phase?.up_to_250 || 0; 
    cost += Number(fixedCharge);

    return Number(cost.toFixed(2));
  }
}

export default SolarExportCalculator;