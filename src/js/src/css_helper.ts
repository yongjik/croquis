// Helper for handling CSS properties.
//
// In theory, it might be a nice idea to "separate content (HTML) from
// presentation (CSS)", but in reality, it doesn't really work for us.
// The fact that, say, "div.cr_x_axis" has only "border-top" is not a
// presentation detail; it's an essential part of the *content* because the
// "border-top" is the freaking X axis!
//
// In other words, I found that a separate CSS file actually made it *harder* to
// understand code.  Since we're dynamically generating the HTML elements
// anyway, let's also apply style here dynamically, so that it's easier to
// understand what's going on.

import { assert } from './util.js';

// Helper function.
function apply_over_children(
    elem: HTMLElement, selector: string, f: (_: HTMLElement) => void
) {
    let children = elem.querySelectorAll(selector);
    assert(children.length > 0, `No element matching ${selector}`);
    for (let child of children) f(child as HTMLElement);
}

// Helper function for handling very simple "CSS-style" definitions.
// I.e., "width: 50px; height: 30px;" is parsed into
// [['width', '50px'], ['height', '30px']].
//
// Will probably not work for generic cases.
function parsePseudoCSS(s: string): [string, string][] {
    let keyvals: [string, string][] = [];

    for (let kv of s.split(';')) {
        kv = kv.trim();
        if (kv == '') continue;
        let match = kv.match(/([^ ]+)\s*:\s*([^ ].*)/);
        assert(match != null, `Cannot parse "CSS" string ${kv}`);
        keyvals.push([match![1], match![2]]);
    }

    return keyvals;
}

// Generic CSS update function for an element.
export function apply_css(
    elem: HTMLElement, property: string, value: string
): void {
    elem.style.setProperty(property, value);
}

// Generic CSS update function for descendants of an element.
// `settings` is an array of pairs (selector, "property: value; (...)").
export function apply_css_tree(
    elem: HTMLElement, settings: [string, string][]
) {
    for (let [selector, css] of settings) {
        let kv = parsePseudoCSS(css);
        apply_over_children(elem, selector, (child) => {
            for (let [k, v] of kv) child.style.setProperty(k, v);
        });
    }
}

export function disable_drag(elem: HTMLElement, selectors: string[]) {
    for (let selector of selectors) {
        apply_over_children(elem, selector, (child) => {
            child.draggable = false;
        });
    }
}

// Set `elem` as a flex container, and apply "flex" parameters (for sizing) to
// each child using `flex_settings`, which is an array of pairs (selector, flex
// property).
export function apply_flex(
    elem: HTMLElement,
    dir: "row" | "column",
    flex_settings: [string, string][],
) {
    assert(dir == 'row' || dir == 'column', `Invalid dir ${dir}`);

    elem.style.display = 'flex';
    elem.style.setProperty('flex-direction', dir);

    for (let [selector, flex] of flex_settings) {
        apply_over_children(elem, selector, (child) => {
            child.style.flex = flex;
        });
    }
}
