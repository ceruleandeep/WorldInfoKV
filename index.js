import { extension_settings } from '../../../extensions.js';

import {
    saveSettingsDebounced,
    substituteParams,
} from '../../../../script.js';
import { isFalseBoolean, isTrueBoolean, parseStringArray } from '../../../utils.js';
import { Fuse } from '../../../../lib.js';
import {
    ARGUMENT_TYPE,
    SlashCommandArgument,
    SlashCommandNamedArgument,
} from '../../../slash-commands/SlashCommandArgument.js';
import { enumTypes, SlashCommandEnumValue } from '../../../slash-commands/SlashCommandEnumValue.js';
import { commonEnumProviders, enumIcons } from '../../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { SlashCommandClosure } from '../../../slash-commands/SlashCommandClosure.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import {
    // createNewWorldInfo,
    createWorldInfoEntry,
    loadWorldInfo,
    // METADATA_KEY,
    newWorldInfoEntryDefinition,
    newWorldInfoEntryTemplate,
    // onWorldInfoChange,
    originalWIDataKeyMap,
    setWIOriginalDataValue,
    world_info_logic,
    world_info_position,
    world_names,
    worldInfoCache,
} from '../../../world-info.js';

const extensionName = 'SillyTavern-WorldInfoKV';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const defaultSettings = {};

async function loadSettings() {
    //Create the settings if they don't exist
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }

    // Updating settings in the UI
    $('#example_setting').prop('checked', extension_settings[extensionName].example_setting).trigger('input');
}

// This function is called when the extension settings are changed in the UI
function onExampleInput(event) {
    extension_settings[extensionName].example_setting = Boolean($(event.target).prop('checked'));
    saveSettingsDebounced();
}

/**
 * Log a message to the console with the extension name as a prefix
 */
function log(...args) {
    console.log(`[${extensionName}]`, ...args);
}

// This function is called when the button is clicked
function onButtonClick() {
    // You can do whatever you want here
    // Let's make a popup appear with the checked setting
    toastr.info(
        `The checkbox is ${extension_settings[extensionName].example_setting ? 'checked' : 'not checked'}`,
        'A popup appeared because you clicked the button!',
    );
}

function cast(field, value) {
    if (typeof newWorldInfoEntryTemplate[field] === 'boolean') {
        const isTrue = isTrueBoolean(value);
        const isFalse = isFalseBoolean(value);

        if (isTrue) {
            value = String(true);
        }

        if (isFalse) {
            value = String(false);
        }
    }
    return value;
}

function searchFuse(field, value, threshold, entries) {
    log('searchFuse', field, value, threshold, entries);
    value = cast(field, value);

    const fuse = new Fuse(entries, {
        keys: [{ name: field, weight: 1 }],
        includeScore: true,
        threshold: threshold,
    });

    return fuse.search(value).map(x => x.item);
}

function searchExact(field, value, entries) {
    log(`searchExact field=${field}`, field, value, entries);
    const fieldType = newWorldInfoEntryDefinition[field].type;
    value = cast(field, value);
    log('searchExact casted', field, value, typeof value, fieldType);
    return entries.filter(x => {
        const fieldValue = x[field];
        if (fieldType === 'string') {
            return fieldValue === value;
        } else if (fieldType === 'number') {
            return fieldValue === Number(value);
        } else if (fieldType === 'boolean') {
            return fieldValue === isTrueBoolean(value);
        } else if (fieldType === 'array') {
            return fieldValue.includes(value);
        }
        return false;
    });
}

function registerWorldInfoSlashCommands() {
    const localEnumProviders = {
        /** All possible fields that can be set in a WI entry */
        wiEntryFields: () => Object.entries(newWorldInfoEntryDefinition).map(([key, value]) =>
            new SlashCommandEnumValue(key, `[${value.type}] default: ${(typeof value.default === 'string' ? `'${value.default}'` : value.default)}`,
                enumTypes.enum, enumIcons.getDataTypeIcon(value.type))),

        /** All existing UIDs based on the file argument as world name */
        wiUids: (/** @type {import('./slash-commands/SlashCommandExecutor.js').SlashCommandExecutor} */ executor) => {
            const file = executor.namedArgumentList.find(it => it.name === 'file')?.value;
            if (file instanceof SlashCommandClosure) throw new Error('Argument \'file\' does not support closures');
            // Try find world from cache
            if (!worldInfoCache.has(file)) return [];
            const world = worldInfoCache.get(file);
            if (!world) return [];
            return Object.entries(world.entries).map(([uid, data]) =>
                new SlashCommandEnumValue(uid, `${data.comment ? `${data.comment}: ` : ''}${data.key.join(', ')}${data.keysecondary?.length ? ` [${Object.entries(world_info_logic).find(([_, value]) => value === data.selectiveLogic)[0]}] ${data.keysecondary.join(', ')}` : ''} [${getWiPositionString(data)}]`,
                    enumTypes.enum, enumIcons.getWiStatusIcon(data)));
        },
    };

    async function getEntriesFromFile(file) {
        if (!file || !world_names.includes(file)) {
            toastr.warning('Valid World Info file name is required');
            return '';
        }

        const data = await loadWorldInfo(file);

        if (!data || !('entries' in data)) {
            toastr.warning('World Info file has an invalid format');
            return '';
        }

        const entries = Object.values(data.entries);

        if (!entries || entries.length === 0) {
            toastr.warning('World Info file has no entries');
            return '';
        }

        return entries;
    }

    async function findBookEntryCallback(args, value) {
        log('findBookEntryCallback args/value', args, value);
        const file = args.file;
        const field = args.field || 'key';

        const entries = await getEntriesFromFile(file);

        if (!entries) {
            return '';
        }

        const threshold = args.threshold === undefined ? 0.3 : Number(args.threshold);
        const results = args.mode === 'exact'
            ? searchExact(field, value, entries)
            : searchFuse(field, value, threshold, entries);

        if (!results || results.length === 0) {
            return '';
        }
        const result = results[0]?.uid;

        if (result === undefined) {
            return '';
        }

        return result;
    }

    async function getEntryFieldCallback(args, uid) {
        const file = args.file;
        const field = args.field || 'content';

        const entries = await getEntriesFromFile(file);

        if (!entries) {
            return '';
        }

        const entry = entries.find(x => String(x.uid) === String(uid));

        if (!entry) {
            toastr.warning('Valid UID is required');
            return '';
        }

        if (newWorldInfoEntryTemplate[field] === undefined) {
            toastr.warning('Valid field name is required');
            return '';
        }

        const fieldValue = entry[field];

        if (fieldValue === undefined) {
            return '';
        }

        if (Array.isArray(fieldValue)) {
            return JSON.stringify(fieldValue.map(x => substituteParams(x)));
        }

        return substituteParams(String(fieldValue));
    }

    async function createEntryCallback(args, content) {
        const file = args.file;
        const key = args.key;

        const data = await loadWorldInfo(file);

        if (!data || !('entries' in data)) {
            toastr.warning('Valid World Info file name is required');
            return '';
        }

        const entry = createWorldInfoEntry(file, data);

        if (key) {
            entry.key.push(key);
            entry.addMemo = true;
            entry.comment = key;
        }

        if (content) {
            entry.content = content;
        }

        // await saveWorldInfo(file, data);
        // reloadEditor(file);

        return String(entry.uid);
    }

    async function setEntryFieldCallback(args, value) {
        const file = args.file;
        const uid = args.uid;
        const field = args.field || 'content';

        if (value === undefined) {
            toastr.warning('Value is required');
            return '';
        }

        value = value.replace(/\\([{}|])/g, '$1');

        const data = await loadWorldInfo(file);

        if (!data || !('entries' in data)) {
            toastr.warning('Valid World Info file name is required');
            return '';
        }

        const entry = data.entries[uid];

        if (!entry) {
            toastr.warning('Valid UID is required');
            return '';
        }

        if (newWorldInfoEntryTemplate[field] === undefined) {
            toastr.warning('Valid field name is required');
            return '';
        }

        if (Array.isArray(entry[field])) {
            entry[field] = parseStringArray(value);
        } else if (typeof entry[field] === 'boolean') {
            entry[field] = isTrueBoolean(value);
        } else if (typeof entry[field] === 'number') {
            entry[field] = Number(value);
        } else {
            entry[field] = value;
        }

        if (originalWIDataKeyMap[field]) {
            setWIOriginalDataValue(data, uid, originalWIDataKeyMap[field], entry[field]);
        }

        // await saveWorldInfo(file, data);
        // reloadEditor(file);
        return '';
    }

    function getWiPositionString(entry) {
        switch (entry.position) {
            case world_info_position.before:
                return '↑Char';
            case world_info_position.after:
                return '↓Char';
            case world_info_position.EMTop:
                return '↑EM';
            case world_info_position.EMBottom:
                return '↓EM';
            case world_info_position.ANTop:
                return '↑AT';
            case world_info_position.ANBottom:
                return '↓AT';
            case world_info_position.atDepth:
                return `@D${enumIcons.getRoleIcon(entry.role)}`;
            default:
                return '<Unknown>';
        }
    }

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'wikv-findentry',
        aliases: ['wikv-findlore', 'wikv-findwi'],
        returns: 'UID',
        callback: findBookEntryCallback,
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'file',
                description: 'book name',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: commonEnumProviders.worlds,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'field',
                description: 'field value for fuzzy match (default: key)',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: 'key',
                enumList: localEnumProviders.wiEntryFields(),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'mode',
                description: 'fuzzy match mode',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
                defaultValue: 'fuzzy',
                acceptsMultiple: false,
                enumList: [
                    new SlashCommandEnumValue('fuzzy', 'first match below the threshold', enumTypes.enum, enumIcons.default),
                    new SlashCommandEnumValue('exact', 'best match below the threshold', enumTypes.enum, enumIcons.default),
                ],
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'threshold',
                description: 'fuzzy match threshold (0.0 to 1.0)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: false,
                defaultValue: '0.4',
                acceptsMultiple: false,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'multi',
                description: 'Return multiple matches',
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                enumList: commonEnumProviders.boolean('trueFalse')(),
                defaultValue: 'false',
            }),
        ],
        unnamedArgumentList: [
            new SlashCommandArgument(
                'texts', ARGUMENT_TYPE.STRING, true, true,
            ),
        ],
        helpString: `
            <div>
                Find a UID of the record from the specified book using the fuzzy match of a field value (default: key) and pass it down the pipe.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li>
                        <pre><code>/findentry file=chatLore field=key Shadowfang</code></pre>
                    </li>
                </ul>
            </div>
        `,
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'wikv-getentryfield',
        aliases: ['wikv-getlorefield', 'wikv-getwifield'],
        callback: getEntryFieldCallback,
        returns: 'field value',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'file',
                description: 'book name',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: commonEnumProviders.worlds,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'field',
                description: 'field to retrieve (default: content)',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: 'content',
                enumList: localEnumProviders.wiEntryFields(),
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'record UID',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: localEnumProviders.wiUids,
            }),
        ],
        helpString: `
            <div>
                Get a field value (default: content) of the record with the UID from the specified book and pass it down the pipe.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li>
                        <pre><code>/getentryfield file=chatLore field=content 123</code></pre>
                    </li>
                </ul>
            </div>
        `,
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'wikv-createentry',
        callback: createEntryCallback,
        aliases: ['wikv-createlore', 'wikv-createwi'],
        returns: 'UID of the new record',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'file',
                description: 'book name',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: commonEnumProviders.worlds,
            }),
            new SlashCommandNamedArgument(
                'key', 'record key', [ARGUMENT_TYPE.STRING], false,
            ),
        ],
        unnamedArgumentList: [
            new SlashCommandArgument(
                'content', [ARGUMENT_TYPE.STRING], false,
            ),
        ],
        helpString: `
            <div>
                Create a new record in the specified book with the key and content (both are optional) and pass the UID down the pipe.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li>
                        <pre><code>/createentry file=chatLore key=Shadowfang The sword of the king</code></pre>
                    </li>
                </ul>
            </div>
        `,
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'wikv-setentryfield',
        callback: setEntryFieldCallback,
        aliases: ['wikv-setlorefield', 'wikv-setwifield'],
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'file',
                description: 'book name',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: commonEnumProviders.worlds,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'uid',
                description: 'record UID',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: localEnumProviders.wiUids,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'field',
                description: 'field name (default: content)',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: 'content',
                enumList: localEnumProviders.wiEntryFields(),
            }),
        ],
        unnamedArgumentList: [
            new SlashCommandArgument(
                'value', [ARGUMENT_TYPE.STRING], true,
            ),
        ],
        helpString: `
            <div>
                Set a field value (default: content) of the record with the UID from the specified book. To set multiple values for key fields, use comma-delimited list as a value.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li>
                        <pre><code>/setentryfield file=chatLore uid=123 field=key Shadowfang,sword,weapon</code></pre>
                    </li>
                </ul>
            </div>
        `,
    }));
}

// This function is called when the extension is loaded
jQuery(async () => {
    log('Loading');
    const settingsHtml = await $.get(`${extensionFolderPath}/wikv-panel.html`);

    $('#extensions_settings').append(settingsHtml);

    $('#example_setting').on('input', onExampleInput);
    $('#example_button').on('click', onButtonClick);

    await loadSettings();
    registerWorldInfoSlashCommands();
    log('Loaded');
});
