/**
 * Logic to detect Indian state and normalize station data.
 * standardizes state keys to: 'tamil-nadu', 'kerala', etc.
 */
export class SolarParser {
  static REGION_MAP = {
    1413: 'tamil-nadu',
    1399: 'kerala'
  };

    static ADDRESS_KEYWORDS = {
    'tamil nadu': 'tamil-nadu',
    'tamil-nadu': 'tamil-nadu',
    'tn ': 'tamil-nadu',
    '641': 'tamil-nadu',      // pincode prefix example
    'kerala': 'kerala',
    'kl ': 'kerala',
    'kottayam': 'kerala',
    'changanassery': 'kerala',
    'changanachery': 'kerala',
    '686': 'kerala',          // pincode prefix example
  };

  static parse(station) {
    if (!station) return null;

    let state = 'unknown';

    // 1. Detect State via Region Code
    const regionCode = station.regionLevel1;
    if (regionCode && this.REGION_MAP[regionCode]) {
      state = this.REGION_MAP[regionCode];
    } 
    // 2. Fallback to Address Keywords
    else {
      const address = (station.locationAddress || '').toLowerCase();
      for (const [keyword, stateKey] of Object.entries(this.ADDRESS_KEYWORDS)) {
        if (address.includes(keyword)) {
          state = stateKey;
          break;
        }
      }
    }

    // Default fallback
    if (state === 'unknown') state = 'tamil-nadu';

    // 3. Extract Operational Timing
    const startTs = station.startOperatingTime || station.createdDate || null;

    return {
      state,
      stationId: station.id,
      operationalTimestamp: startTs,
      capacityKw: station.installedCapacity ? (station.installedCapacity / 1000) : 0
    };
  }
}