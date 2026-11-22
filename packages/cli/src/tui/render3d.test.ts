import { describe, expect, it } from 'vitest';
import { forgeFrame, scanConstellationFrame } from './render3d.js';

const MONO = { color: 'mono' as const, unicode: false };
const TRUECOLOR = { color: 'truecolor' as const, unicode: true };

describe('forgeFrame', () => {
  it('is deterministic at fixed t (same state, same frame)', () => {
    const a = forgeFrame('IDLE', 40, 20, MONO, 0);
    const b = forgeFrame('IDLE', 40, 20, MONO, 0);
    expect(a).toEqual(b);
    expect(a.join('\n')).toMatchInlineSnapshot(`
      "                                        
                                              
                                              
                                              
                                              
                # # # # # # # # # # #         
        # # # #                       # # # # 
       #                                     #
                   :::::::::::::::            
             :::::::::::::::::::::::::::      
         :: ::::::::::::::::::::::::::::: ::  
       :::::::::::::::::::::::::::::::::::::::
      :::::::::::::::: ::::::: :::::::::::::::
      ::::::::::::::::::::::::::::::::::::::::
      --------:---::: :: ::: :: ::::::::::::::
      ------ --- --------:-::::::::: ::: :::::
      =====-= --- - -- -- - -- :: : ::: ::::::
      === == ======= = -- - -- - -:-:::: :: ::
      ==== == = == = ==== = ---- - -- : :: :::
      ++=++== == = = == = = = =- - - -- ::::::
      ++ ++ + +    == = = = = = =-    - - -: :
      ++ ++ +         + = = = =         - -- :
      +++*+ +         + + + + =         - ----
      ** ** *         + + + + +         - -- -
      ** ** * **    + + + + + + +    == = =- -
       *** ** ** * * ** * + + ++ + + == == =--
      *** ***** ** * **** * ++++ + ++ ===== ==
      *********** ** * ** * ** + ++ ++++======
      ***######**** ** ** * ** ++ +++++++=====
      ****#######**** ** *** ** ++++++++======
         ****#####***************+++++++====  
             ********************+++++==      
                   ************+++            
       #                                     #
        # # # #                       # # # # 
                # # # # # # # # # # #         
                                              
                                              
                                              
                                              "
    `);
  });

  it('mono fallback renders the lens body in ASCII glyphs', () => {
    const frame = forgeFrame('IDLE', 32, 12, MONO, 3);
    const joined = frame.join('\n');
    expect(joined).toMatch(/[#%*=+.:-]/);
    // shading varies across the lens body (lit face vs dark side)
    expect(new Set(joined.replace(/ /g, '')).size).toBeGreaterThan(2);
  });

  it('truecolor frame carries ansi color sequences', () => {
    const frame = forgeFrame('DETECTED', 32, 12, TRUECOLOR, 1);
    expect(frame.join('\n')).toContain('[');
  });

  it('every Forge state renders without error', () => {
    for (const s of ['IDLE', 'SCANNING', 'ANALYZING', 'DETECTED', 'COMPLETED', 'ERROR'] as const) {
      expect(() => forgeFrame(s, 24, 10, TRUECOLOR, 2)).not.toThrow();
    }
  });
});

describe('scanConstellationFrame', () => {
  it('lights completed nodes and leaves the rest dim', () => {
    const nodes = [
      { name: 'lodash', lit: true },
      { name: 'react', lit: false },
    ];
    const frame = scanConstellationFrame(nodes, 40, 8, MONO, 0);
    const joined = frame.join('\n');
    expect(joined).toContain('●');
    expect(joined).toContain('○');
    expect(joined).toContain('lodash');
    expect(joined).toContain('react');
  });
});
