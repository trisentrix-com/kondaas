
class SolarExportCalculator {

  static calculateMonthlyCredit(units, tariffTemplate) {
    if (!units || units <= 0) return 0;
    if (!tariffTemplate) return 0;

    const state = (tariffTemplate._id || 'tamil-nadu').toLowerCase();
    const slabs = tariffTemplate.slabs;
    let cost = 0;

    // --- KERALA LOGIC ---
    if (state === 'kerala') {
      const telescopic = slabs?.telescopic_up_to_250 || [];
      const nonTelescopic = slabs?.non_telescopic_above_250 || [];

      // Determine the threshold from the last telescopic slab (usually 250)
      let threshold = 250;
      if (telescopic.length > 0) {
        const lastSlab = telescopic[telescopic.length - 1];
        threshold = (lastSlab.to === null) ? Infinity : Number(lastSlab.to);
      }

      if (units <= threshold) {
        // CASE A: Telescopic (Progressive)
        let remaining = units;
        for (const slab of telescopic) {
          if (remaining <= 0) break;
          const slabStart = Number(slab.from || 0);
          const slabEnd = (slab.to === null) ? Infinity : Number(slab.to);
          const slabUnits = Math.min(remaining, (slabEnd - slabStart + 1));
          
          cost += slabUnits * Number(slab.rate);
          remaining -= slabUnits;
        }
      } else {
        // CASE B: Non-Telescopic (Flat rate on ALL units if above threshold)
        let flatRate = 9.20; // Fallback
        for (const slab of nonTelescopic) {
          const from = Number(slab.from || 0);
          const to = (slab.to === null) ? Infinity : Number(slab.to);
          if (units >= from && units <= to) {
            flatRate = Number(slab.rate);
            break;
          }
        }
        cost = units * flatRate;
      }
    } 
    // --- TAMIL NADU / PROGRESSIVE LOGIC ---
    else {
      let remaining = units;
      // Ensure slabs are sorted by the 'from' range
      const sortedSlabs = [...slabs].sort((a, b) => a.from - b.from);

      for (const slab of sortedSlabs) {
        if (remaining <= 0) break;
        const slabStart = Number(slab.from || 0);
        const slabEnd = (slab.to === null) ? Infinity : Number(slab.to);
        const slabUnits = Math.min(remaining, (slabEnd - slabStart + 1));

        if (slabUnits > 0) {
          cost += slabUnits * Number(slab.rate);
          remaining -= slabUnits;
        }
      }
    }

    // Add fixed charges if they exist in the template
    const fixedCharge = tariffTemplate.fixedCharges?.single_phase?.up_to_250 || 0; 
    cost += Number(fixedCharge);

    return Number(cost.toFixed(2));
  }
}

export default SolarExportCalculator;