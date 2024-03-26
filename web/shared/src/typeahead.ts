import _ from "lodash";

/*
    We hand selected the following emojis a few years
    ago to be given extra precedence in our typeahead
    algorithms and emoji picker UIs.  We call them "popular"
    emojis for historical reasons, although we've never
    technically measured their popularity (and any
    results now would be biased in favor of the ones
    below, since they've easier to submit).  Nonetheless, it
    is often convenient to quickly find these.  We can
    adjust this list over time; we just need to make
    sure it works well with the emoji picker's layout
    if you increase the number of them.

    For typeahead we'll favor any of these as long as
    the emoji code matches.  For example, we'll show the
    emoji with code 1f44d at the top of your suggestions
    whether you type "+" as a prefix for "+1"
    or "th" as a prefix for "thumbs up".
*/
export const popular_emojis = [
    "1f44d", // +1
    "1f389", // tada
    "1f642", // smile
    "2764", // heart
    "1f6e0", // working_on_it
    "1f419", // octopus
];

const unicode_marks = /\p{M}/gu;

type Emoji =
    | {
          emoji_name: string;
          reaction_type: "realm_emoji" | "zulip_extra_emoji";
          is_realm_emoji: true;
      }
    | UnicodeEmoji;

// emoji_code is only available for unicode emojis.
type UnicodeEmoji = {
    emoji_name: string;
    emoji_code: string;
    reaction_type: "unicode_emoji";
    is_realm_emoji: false;
};

export function remove_diacritics(s: string): string {
    return s.normalize("NFKD").replace(unicode_marks, "");
}

// This function attempts to match a query with a source text.
// * query is the user-entered search query
// * source_str is the string we're matching in, e.g. a user's name
// * split_char is the separator for this syntax (e.g. ' ').
export function query_matches_string(
    query: string,
    source_str: string,
    split_char: string,
): boolean {
    source_str = source_str.toLowerCase();
    source_str = remove_diacritics(source_str);

    if (!query.includes(split_char)) {
        // If query is a single token (doesn't contain a separator),
        // the match can be anywhere in the string.
        return source_str.includes(query);
    }
    const queries = query.split(split_char);
    const source_arr = source_str.split(split_char);

    // Require a prefix match for every word (e.g., for 'ab cd ef',
    // the query can be 'ab c', 'a c e', 'a e', 'ef', but not 'b cd','b ' or 'efg', etc.).
    // Without the space i.e. for a single word in query, we only see whether whole search word includes query
    // (e.g., for 'King Hamlet', the query can be 'in', 'ing', 'am', 'le' or 'ng', etc.).
    // The order of query words separated by space doesn't matter like
    // (e.g., for 'ab cd ef', the query can be 'ef cd' or 'e cd a' , etc.).
    return queries.every((query) =>
        source_arr.some((source) => source !== undefined && source.startsWith(query)),
    );
}

function clean_query(query: string): string {
    query = remove_diacritics(query);
    // When `abc ` with a space at the end is typed in
    // a content-editable widget such as the composebox
    // direct message section, the space at the end was
    // a `no break-space (U+00A0)` instead of `space (U+0020)`,
    // which lead to no matches in those cases.
    query = query.replace(/\u00A0/g, " ");

    return query;
}

export function clean_query_lowercase(query: string): string {
    query = query.toLowerCase();
    query = clean_query(query);
    return query;
}

export const parse_unicode_emoji_code = (code: string): string =>
    code
        .split("-")
        .map((hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .join("");

export function get_emoji_matcher(query: string): (emoji: Emoji) => boolean {
    // replace spaces with underscores for emoji matching
    query = query.replace(/ /g, "_");
    query = clean_query_lowercase(query);

    return function (emoji) {
        const matches_emoji_literal =
            emoji.reaction_type === "unicode_emoji" &&
            parse_unicode_emoji_code(emoji.emoji_code) === query;
        return matches_emoji_literal || query_matches_string(query, emoji.emoji_name, "_");
    };
}

// space, hyphen, underscore and slash characters are considered word
// boundaries for now, but we might want to consider the characters
// from BEFORE_MENTION_ALLOWED_REGEX in zerver/lib/mention.py later.
export const word_boundary_chars = " _/-";

export function triage_raw<T>(
    query: string,
    objs: T[],
    get_item: (x: T) => string,
): {
    exact_matches: T[];
    begins_with_case_sensitive_matches: T[];
    begins_with_case_insensitive_matches: T[];
    word_boundary_matches: T[];
    no_matches: T[];
} {
    /*
        We split objs into five groups:

            - entire string exact match
            - match prefix exactly with `query`
            - match prefix case-insensitively
            - match word boundary prefix case-insensitively
            - other

        and return an object of these.
    */
    const exact_matches = [];
    const begins_with_case_sensitive_matches = [];
    const begins_with_case_insensitive_matches = [];
    const word_boundary_matches = [];
    const no_matches = [];
    const lower_query = query ? query.toLowerCase() : "";

    for (const obj of objs) {
        const item = get_item(obj);
        const lower_item = item.toLowerCase();

        if (lower_item === lower_query) {
            exact_matches.push(obj);
        } else if (item.startsWith(query)) {
            begins_with_case_sensitive_matches.push(obj);
        } else if (lower_item.startsWith(lower_query)) {
            begins_with_case_insensitive_matches.push(obj);
        } else if (
            new RegExp(`[${word_boundary_chars}]${_.escapeRegExp(lower_query)}`).test(lower_item)
        ) {
            word_boundary_matches.push(obj);
        } else {
            no_matches.push(obj);
        }
    }

    return {
        exact_matches,
        begins_with_case_sensitive_matches,
        begins_with_case_insensitive_matches,
        word_boundary_matches,
        no_matches,
    };
}

export function triage<T>(
    query: string,
    objs: T[],
    get_item: (x: T) => string,
    sorting_comparator?: (a: T, b: T) => number,
): {matches: T[]; rest: T[]} {
    const {
        exact_matches,
        begins_with_case_sensitive_matches,
        begins_with_case_insensitive_matches,
        word_boundary_matches,
        no_matches,
    } = triage_raw(query, objs, get_item);

    if (sorting_comparator) {
        const beginning_matches_sorted = [
            ...begins_with_case_sensitive_matches,
            ...begins_with_case_insensitive_matches,
        ].sort(sorting_comparator);
        return {
            matches: [
                ...exact_matches.sort(sorting_comparator),
                ...beginning_matches_sorted,
                ...word_boundary_matches.sort(sorting_comparator),
            ],
            rest: no_matches.sort(sorting_comparator),
        };
    }

    return {
        matches: [
            ...exact_matches,
            ...begins_with_case_sensitive_matches,
            ...begins_with_case_insensitive_matches,
            ...word_boundary_matches,
        ],
        rest: no_matches,
    };
}

export function sort_emojis<T extends Emoji>(objs: T[], query: string): T[] {
    // replace spaces with underscores for emoji matching
    query = query.replace(/ /g, "_");
    query = query.toLowerCase();

    function decent_match(name: string): boolean {
        const pieces = name.toLowerCase().split("_");
        return pieces.some((piece) => piece.startsWith(query));
    }

    const popular_set = new Set(popular_emojis);

    function is_popular(obj: Emoji): boolean {
        return (
            obj.reaction_type === "unicode_emoji" &&
            popular_set.has(obj.emoji_code) &&
            decent_match(obj.emoji_name)
        );
    }

    const realm_emoji_names = new Set(
        objs.filter((obj) => obj.is_realm_emoji).map((obj) => obj.emoji_name),
    );

    const perfect_emoji_matches = objs.filter((obj) => obj.emoji_name === query);
    const without_perfect_matches = objs.filter((obj) => obj.emoji_name !== query);

    const popular_emoji_matches = without_perfect_matches.filter((obj) => is_popular(obj));
    const others = without_perfect_matches.filter((obj) => !is_popular(obj));

    const triage_results = triage(query, others, (x) => x.emoji_name);

    function prioritise_realm_emojis(emojis: T[]): T[] {
        return [
            ...emojis.filter((emoji) => emoji.is_realm_emoji),
            ...emojis.filter((emoji) => !emoji.is_realm_emoji),
        ];
    }

    const sorted_results_with_possible_duplicates = [
        ...perfect_emoji_matches,
        ...popular_emoji_matches,
        ...prioritise_realm_emojis(triage_results.matches),
        ...prioritise_realm_emojis(triage_results.rest),
    ];
    // remove unicode emojis with same code but different names
    // and unicode emojis overridden by realm emojis with same names
    const unicode_emoji_codes = new Set();
    const sorted_unique_results: T[] = [];
    for (const emoji of sorted_results_with_possible_duplicates) {
        if (emoji.reaction_type !== "unicode_emoji") {
            sorted_unique_results.push(emoji);
        } else if (
            !unicode_emoji_codes.has(emoji.emoji_code) &&
            !realm_emoji_names.has(emoji.emoji_name)
        ) {
            unicode_emoji_codes.add(emoji.emoji_code);
            sorted_unique_results.push(emoji);
        }
    }

    return sorted_unique_results;
}
