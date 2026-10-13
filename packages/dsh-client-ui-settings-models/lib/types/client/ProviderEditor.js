import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * One provider's editor card, hand-written per adapter family: the primary
 * field is a list of named **API key** cards, one per stored key profile. The
 * page never asks for an environment-variable name — the selected card's
 * reference is what `apiKeyEnv` names, a typed key stores through
 * `credentials/set` under that card's own reference, and a card added later
 * derives `<ROUTE>_API_KEY_2`, `_3`, … from the route's conventional
 * reference. The profiles persist as `apiKeyProfiles`, so switching between
 * keys is a selection rather than a re-typed value; the pi-ai profile records
 * the derived `apiKeyEnv` only once the user has touched key settings, and an
 * untouched card materializes no reference-free profile, which is what keeps
 * provider-native authentication available;
 * the collapsed 自定义设置 area carries the per-family extras (`baseURL` for
 * both families, DeepSeek's id/name/context-window model catalog, and the
 * display name and wire protocol of a pi-ai route the adapter does not ship —
 * the two fields the create card asked that route for, editable here for the
 * same reason).
 * Reasoning effort is deliberately absent: it is a per-MODEL capability, and
 * the models under one provider disagree about it, so a provider-scoped
 * control can only be set to a value some of them reject. The composer's
 * model picker offers each model its own levels; `cordis.patch.yml` keeps the
 * profile field for a deployment that knows its route. Everything else stays
 * owned by `cordis.patch.yml`. Profile edits land as minimal `settings.mutate`
 * path ops against the stored section — the card names only the fields it can
 * see instead of rebuilding the whole subtree from a partial descriptor.
 */
import { useEffect, useMemo, useState } from 'react';
import { DeepSeekModelsEditor, modelDrafts, validateDeepSeekModels, } from "./DeepSeekModelsEditor.js";
import { apiKeyFailure } from "./apiKey.js";
import { EditorFooter } from "./EditorFooter.js";
import { ModelListEditor } from "./ModelListEditor.js";
import { deriveKeyRef, protocolChoices } from "./store.js";
import { protocolLabel } from "./protocol-label.js";
import styles from './ModelsSection.module.css';
/** Local class-name joiner for conditional card styling. */
function cx(...names) {
    return names.filter((name) => typeof name === 'string').join(' ');
}
/** Read named profiles from the stored settings section, or an empty list. */
function keyProfilesAt(schema, namespace, path) {
    const profile = schema.getPath(namespace.value, path);
    if (typeof profile !== 'object' || profile === null)
        return [];
    const raw = profile.apiKeyProfiles;
    if (!Array.isArray(raw))
        return [];
    return raw.filter((entry) => (typeof entry === 'object'
        && entry !== null
        && typeof entry.ref === 'string'
        && typeof entry.name === 'string'));
}
/** The profiles this card starts with, including the active legacy reference. */
function initialKeyProfiles(schema, namespace, path, provider, defaultName) {
    const stored = keyProfilesAt(schema, namespace, path);
    const active = refFor(schema, namespace, path, provider);
    if (stored.some(profile => profile.ref === active))
        return stored;
    return [{ ref: active, name: defaultName }, ...stored];
}
/** A conventional reference name for the next added key profile. */
function nextKeyRef(base, profiles) {
    const taken = new Set(profiles.map(profile => profile.ref));
    let index = 2;
    while (taken.has(`${base}_${String(index)}`))
        index += 1;
    return `${base}_${String(index)}`;
}
/** A user-section subtree as a plain draft object (absent → empty). */
function draftAt(schema, namespace, path) {
    const subtree = schema.getPath(namespace.user, path);
    if (typeof subtree !== 'object' || subtree === null || Array.isArray(subtree))
        return {};
    return structuredClone(subtree);
}
/**
 * The minimal path ops carrying `after` over `before`, both as the card sees
 * them. Only keys the card observed are named; fields absent from both sides
 * produce no op, which is why edits are path-addressed rather than a rebuilt
 * section.
 * @param base - path of the edited subtree inside the user section.
 * @param before - the subtree as loaded, or undefined when it is new.
 * @param after - the subtree as edited.
 * @returns ordered set/unset ops; empty when nothing changed.
 */
export function pathOps(base, before, after) {
    const previous = typeof before === 'object' && before !== null && !Array.isArray(before)
        ? before
        : {};
    const ops = [];
    for (const [key, value] of Object.entries(after)) {
        if (JSON.stringify(previous[key]) === JSON.stringify(value))
            continue;
        ops.push({ op: 'set', path: [...base, key], value: value });
    }
    for (const key of Object.keys(previous)) {
        if (!(key in after))
            ops.push({ op: 'unset', path: [...base, key] });
    }
    return ops;
}
/** The editor layout the owning namespace selects. */
function layoutOf(ns) {
    if (ns === 'llm-deepseek')
        return 'deepseek';
    if (ns === 'llm-pi-ai')
        return 'pi-ai';
    return 'unknown';
}
/** The credential reference this profile resolves keys through. */
function refFor(schema, namespace, path, provider) {
    const profile = schema.getPath(namespace.value, path);
    const named = typeof profile === 'object' && profile !== null
        ? profile.apiKeyEnv
        : undefined;
    return typeof named === 'string' && named.length > 0 ? named : deriveKeyRef(provider);
}
/**
 * Render one provider's editing card.
 * @param props - the addressed profile plus wire faces and copy.
 * @returns the editor card.
 */
export function ProviderEditor(props) {
    const { namespace, schema, settingsPath, operations, t } = props;
    const initialProfiles = initialKeyProfiles(schema, namespace, settingsPath, props.provider, t('keyDefault'));
    const [draft, setDraft] = useState(() => draftAt(schema, namespace, settingsPath));
    const [keyProfiles, setKeyProfiles] = useState(initialProfiles);
    const [activeRef, setActiveRef] = useState(() => refFor(schema, namespace, settingsPath, props.provider));
    const [credentialStates, setCredentialStates] = useState({});
    const [keyInputs, setKeyInputs] = useState({});
    const [editingRef, setEditingRef] = useState(() => refFor(schema, namespace, settingsPath, props.provider));
    // The card whose input the user just opened, so that opening one moves focus
    // while merely rendering the page does not.
    const [focusRef, setFocusRef] = useState(null);
    const [deletedRefs, setDeletedRefs] = useState([]);
    const [keySettingsTouched, setKeySettingsTouched] = useState(false);
    const [busy, setBusy] = useState(false);
    const [listBusy, setListBusy] = useState(false);
    const { onBusyChange } = props;
    useEffect(() => { onBusyChange?.(busy || listBusy); }, [busy, listBusy, onBusyChange]);
    const [failure, setFailure] = useState(undefined);
    // A settings success advances both retry baselines immediately. Keeping the
    // derived fields in the draft prevents a pushed namespace refresh from
    // turning them into deletions when the following credential write is retried.
    const [committedOriginal, setCommittedOriginal] = useState(() => schema.getPath(namespace.user, settingsPath));
    const [expectedRevision, setExpectedRevision] = useState(() => namespace.revision);
    const root = useMemo(() => schema.rehydrate(namespace.schema), [namespace.schema, schema]);
    const node = useMemo(() => schema.nodeAtPath(root, settingsPath), [root, schema, settingsPath]);
    const fallback = schema.getPath(namespace.value, settingsPath);
    const disabled = props.readOnly || busy;
    const accountProvider = props.provider === 'deepseek-account';
    // Account settings use a configurable Cordis entry id.
    const layout = accountProvider ? 'deepseek' : layoutOf(namespace.ns);
    const keyRef = refFor(schema, namespace, settingsPath, props.provider);
    const keyRefsKey = keyProfiles.map(profile => profile.ref).join('\u0000');
    const keyRefs = useMemo(() => Array.from(new Set(keyProfiles.map(profile => profile.ref))), [keyRefsKey]);
    // The same schema read the create card makes, so the choices offered here
    // and there cannot drift apart: both come from the adapter's own `Config`.
    // Only the pi-ai layout has a per-route protocol for the read to find, and
    // it rehydrates the whole section schema, so the other layouts skip it.
    const protocols = useMemo(() => layout === 'pi-ai' ? protocolChoices(namespace, schema) : [], [layout, namespace, schema]);
    useEffect(() => {
        if (accountProvider)
            return;
        let stale = false;
        setCredentialStates({});
        // Each named profile carries its own reference, so every card's stored
        // state is read together; a refused read leaves that card without the
        // "already configured" hint rather than blocking the editor.
        void Promise.all(keyRefs.map(async (ref) => {
            const described = await operations.describeCredential(ref);
            return [ref, described];
        })).then((entries) => {
            if (stale)
                return;
            const next = {};
            for (const [ref, described] of entries) {
                if (described !== undefined)
                    next[ref] = described;
            }
            setCredentialStates(next);
        }, () => undefined);
        return () => { stale = true; };
    }, [operations, keyRefs, accountProvider]);
    const stringAt = (source, key) => {
        const value = schema.getPath(source, [key]);
        return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
    };
    const setField = (key, next) => {
        // A value of nothing but whitespace is cleared, not stored: `stringAt`
        // already reports it as absent, so the field would otherwise render empty
        // while the draft still carried the spaces into `cordis.patch.yml`, where
        // both adapters would accept that non-empty string as a real value.
        const value = next === undefined || next.trim().length === 0 ? undefined : next;
        setDraft(current => value === undefined
            ? schema.deletePath(current, [key])
            : schema.setPath(current, [key], value));
    };
    // The model list is validated by the same per-row checker for both families,
    // so a bad row is named by its position rather than by a blanket message.
    const modelFailure = validateDeepSeekModels(schema.getPath(draft, ['models']));
    // The active profile is the one whose reference `apiKeyEnv` will name, so it
    // answers what a probe or a required-credential gate must ask about it.
    const activeKeyDraft = keyInputs[activeRef] ?? '';
    const activeKeyValue = activeKeyDraft.trim();
    const activeKeyFailure = apiKeyFailure(activeKeyDraft);
    const anyKeyFailure = Object.values(keyInputs).some(value => apiKeyFailure(value) !== undefined);
    const activeConfigured = credentialStates[activeRef]?.configured === true;
    const credentialRequiredFailure = props.credentialRequired === true
        && !activeConfigured && activeKeyValue.length === 0
        ? 'keyRequired'
        : undefined;
    const shownKeyFailure = credentialRequiredFailure
        ?? (editingRef === null ? undefined : apiKeyFailure(keyInputs[editingRef] ?? ''));
    // What the form currently shows, which is what an interrogation must ask:
    // an edited-but-unsaved endpoint, and a key typed but not yet stored.
    const probeApi = stringAt(draft, 'api') ?? stringAt(fallback, 'api');
    const probeBaseURL = stringAt(draft, 'baseURL') ?? stringAt(fallback, 'baseURL');
    const probe = {
        settingsNs: namespace.ns,
        // Naming the route lets an adapter that already describes it answer from
        // its own registry — better metadata, no network call, no endpoint needed.
        provider: props.provider,
        ...probeBaseURL === undefined ? {} : { baseURL: probeBaseURL },
        ...probeApi === undefined ? {} : { api: probeApi },
        ...activeKeyValue.length === 0 ? {} : { apiKey: activeKeyValue },
    };
    /**
     * The write for this card, or a failure message. Every edit travels as
     * path ops against the STORED section: the draft comes from the redacted
     * descriptor, so a wholesale replace rebuilt from it could delete fields
     * outside the card. Ops name only the fields this card can see.
     */
    const applyOnce = async () => {
        const ns = namespace.ns;
        // The named profiles and the reference the route resolves are one edit: the
        // card writes both once the user has touched key settings, so an untouched
        // card leaves `apiKeyEnv` — and with it a pi-ai route's provider-native
        // authentication path — exactly as it was.
        const next = props.credentialOnly === true || !keySettingsTouched
            ? draft
            : schema.setPath(schema.setPath(draft, ['apiKeyEnv'], activeRef), ['apiKeyProfiles'], keyProfiles.map(profile => ({ ref: profile.ref, name: profile.name.trim() })));
        if (props.credentialOnly !== true) {
            // The same checker gates the submit button, so a card cannot reach this
            // with a bad row; it stays because the schema check below would refuse
            // the write with a message naming a path instead of the row, and because
            // nothing but this function decides what is written.
            const failure = validateDeepSeekModels(schema.getPath(next, ['models']));
            /* v8 ignore next 3 -- unreachable from the card: the same failure disables submit */
            if (failure !== undefined) {
                return `${t('model')} ${String(failure.index + 1)}: ${t(failure.key)}`;
            }
        }
        /* v8 ignore next -- apply is only reachable from the rendered card, which required a resolved node */
        if (props.credentialOnly !== true && node !== undefined && settingsPath.length === 0) {
            const sectionError = schema.validate(node, next);
            if (sectionError !== undefined)
                return sectionError;
        }
        const materializesNativeProfile = layout === 'pi-ai'
            && fallback === undefined
            && committedOriginal === undefined
            && Object.keys(next).length === 0;
        const ops = props.credentialOnly === true
            ? []
            : materializesNativeProfile
                ? [{ op: 'set', path: [...settingsPath], value: {} }]
                : pathOps(settingsPath, committedOriginal, next);
        if (ops.length > 0) {
            const written = await operations.writeSettings(ns, ops, expectedRevision);
            if (written.kind !== 'written')
                return written.kind === 'conflict' ? t('conflict') : written.message;
            setCommittedOriginal(schema.getPath(written.view.user, settingsPath));
            setExpectedRevision(written.view.revision);
            setDraft(next);
            setKeySettingsTouched(false);
        }
        // A key typed into any card stores under that card's own reference; a
        // removed card's reference is unset once no surviving profile names it.
        const pendingWrites = Object.entries(keyInputs).flatMap(([ref, value]) => {
            const trimmed = value.trim();
            if (deletedRefs.includes(ref) || trimmed.length === 0)
                return [];
            return [{ ref, value: trimmed }];
        });
        for (const write of pendingWrites) {
            const stored = await operations.storeCredential(write.ref, write.value);
            if (stored !== undefined)
                return stored;
        }
        const liveRefs = new Set(keyProfiles.map(profile => profile.ref));
        for (const ref of deletedRefs.filter(ref => !liveRefs.has(ref))) {
            const removed = await operations.removeCredential(ref);
            if (removed !== undefined)
                return removed;
        }
        setKeyInputs({});
        setEditingRef(null);
        setDeletedRefs([]);
        return undefined;
    };
    const apply = async () => {
        setBusy(true);
        setFailure(undefined);
        try {
            const failure = await applyOnce();
            if (failure !== undefined) {
                setFailure(failure);
                return;
            }
            props.onClose(true);
        }
        finally {
            setBusy(false);
        }
    };
    if (node === undefined) {
        // A directory entry addressing a position its schema cannot resolve is a
        // host-side inconsistency; showing it beats a blank card.
        return _jsxs("p", { className: styles['error'], children: [props.provider, ": ", props.t('settingsPathUnresolvable')] });
    }
    const updateKeyName = (ref, name) => {
        setKeyProfiles(profiles => profiles.map(profile => profile.ref === ref ? { ...profile, name } : profile));
        setKeySettingsTouched(true);
    };
    const addKeyProfile = () => {
        const ref = nextKeyRef(keyRef, keyProfiles);
        const name = `${t('keyDefault')} ${String(keyProfiles.length + 1)}`;
        setKeyProfiles(profiles => [...profiles, { ref, name }]);
        setActiveRef(ref);
        setEditingRef(ref);
        setKeyInputs(current => ({ ...current, [ref]: '' }));
        setKeySettingsTouched(true);
    };
    const deleteKeyProfile = (ref) => {
        // The route always resolves one reference, so the last profile stays.
        if (keyProfiles.length <= 1)
            return;
        const index = keyProfiles.findIndex(profile => profile.ref === ref);
        const next = keyProfiles.filter(profile => profile.ref !== ref);
        setKeyProfiles(next);
        setDeletedRefs(current => current.includes(ref) ? current : [...current, ref]);
        setKeyInputs(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== ref)));
        if (activeRef === ref) {
            setActiveRef(next[Math.max(0, Math.min(index, next.length - 1))]?.ref ?? activeRef);
        }
        if (editingRef === ref)
            setEditingRef(null);
        setKeySettingsTouched(true);
    };
    const selectActiveRef = (ref) => {
        setActiveRef(ref);
        setKeySettingsTouched(true);
    };
    /**
     * The catalog beneath the user layer: what the composition entry pinned, or
     * else the schema default that `resolve` would supply. The effective value
     * cannot answer this — it still carries the stored override until the unset
     * is applied, so reading it would echo that override straight back the
     * moment reset drops it, leaving the rows unchanged until a reload.
     */
    const inheritedModels = () => {
        const pinned = schema.getPath(namespace.base, [...settingsPath, 'models']);
        return pinned ?? schema.nodeAtPath(root, [...settingsPath, 'models'])?.meta.default;
    };
    /**
     * The curated fields of one known adapter family. The family arrives
     * narrowed so the per-family branches below are total: an unknown namespace
     * renders the hint instead and never reaches this body.
     */
    const curatedFields = (family) => {
        // What a hand-declared route names for itself and nothing else can supply.
        // A whole-section `llm-deepseek` profile is a composition fact with no
        // per-route identity for its schema to carry, hence the family test.
        const ownsIdentity = family === 'pi-ai' && props.declared === true;
        const customModels = schema.getPath(draft, ['models']);
        const modelsOverridden = schema.hasPath(draft, ['models']);
        const models = modelDrafts(modelsOverridden ? customModels : inheritedModels());
        const defaultContextWindow = schema.getPath(fallback, ['defaultContextWindow']);
        const defaultMaxTokens = schema.getPath(fallback, ['maxTokens']);
        const defaultInput = schema.getPath(fallback, ['defaultInput']);
        /** What both family editors take: the rows, whose layer owns them, and the two writes. */
        const catalogProps = {
            models,
            overridden: modelsOverridden,
            t,
            disabled,
            onChange: (next) => {
                setDraft(current => schema.setPath(current, ['models'], next));
            },
            onReset: () => { setDraft(current => schema.deletePath(current, ['models'])); },
        };
        if (accountProvider)
            return _jsx(DeepSeekModelsEditor, { ...catalogProps, defaultContextWindow: typeof defaultContextWindow === 'number' ? defaultContextWindow : undefined, defaultMaxTokens: typeof defaultMaxTokens === 'number' ? defaultMaxTokens : undefined });
        return (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles['field'], children: [_jsx("span", { className: styles['fieldLabel'], children: t('keyInput') }), _jsxs("div", { className: styles['keyList'], children: [keyProfiles.map((profile) => {
                                    const configured = credentialStates[profile.ref]?.configured === true;
                                    const locked = credentialStates[profile.ref]?.writable === false;
                                    const editing = editingRef === profile.ref;
                                    const inputValue = keyInputs[profile.ref] ?? '';
                                    const inputFailure = apiKeyFailure(inputValue);
                                    const status = profile.ref === activeRef
                                        ? t('keyCurrent')
                                        : configured ? t('keyConfiguredCard') : t('keyAvailable');
                                    return (_jsxs("div", { className: cx(styles['keyCard'], profile.ref === activeRef && styles['keyCardActive']), role: "button", tabIndex: 0, onClick: () => { selectActiveRef(profile.ref); }, onKeyDown: (event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                selectActiveRef(profile.ref);
                                            }
                                        }, children: [_jsxs("div", { className: styles['keyCardHead'], children: [_jsx("span", { className: cx(styles['keyRadio'], profile.ref === activeRef && styles['keyRadioActive']), "aria-hidden": "true" }), _jsx("input", { className: styles['keyName'], value: profile.name, "aria-label": t('keyName'), disabled: disabled, onClick: (event) => { event.stopPropagation(); }, onChange: (event) => {
                                                            event.stopPropagation();
                                                            updateKeyName(profile.ref, event.target.value);
                                                        }, onKeyDown: (event) => { event.stopPropagation(); } }), _jsx("span", { className: cx(styles['keyStatus'], status === t('keyCurrent') && styles['keyStatusCurrent']), children: status })] }), _jsxs("div", { className: styles['keyCardBody'], onClick: (event) => { event.stopPropagation(); }, children: [editing
                                                        ? (_jsx("input", { className: styles['input'], type: "password", autoComplete: "new-password", value: inputValue, placeholder: locked
                                                                ? t('keyEnvLocked')
                                                                : configured
                                                                    ? t('keyStored')
                                                                    : family === 'pi-ai' ? t('keyPlaceholderNative') : t('keyPlaceholder'), "aria-label": t('keyInput'), "aria-invalid": inputFailure !== undefined, required: props.credentialRequired === true, disabled: disabled || locked, 
                                                            // The card the page opened with may take focus only
                                                            // when its owner asked for that; a card the user just
                                                            // opened for editing always does.
                                                            autoFocus: props.autoFocusCredential === true || focusRef === profile.ref, onChange: (event) => {
                                                                setKeyInputs(current => ({ ...current, [profile.ref]: event.target.value }));
                                                                setKeySettingsTouched(true);
                                                            } }))
                                                        : _jsx("span", { className: styles['keyMask'], children: configured ? t('keyMask') : t('keyMissing') }), inputFailure === undefined ? null : _jsx("p", { className: styles['error'], children: inputFailure === 'keyBlank' && credentialRequiredFailure !== undefined
                                                            ? t(credentialRequiredFailure)
                                                            : t(inputFailure) }), _jsx("button", { type: "button", className: styles['keyAction'], disabled: disabled || locked, onClick: () => {
                                                            setEditingRef(profile.ref);
                                                            setFocusRef(profile.ref);
                                                            setKeyInputs(current => ({ ...current, [profile.ref]: current[profile.ref] ?? '' }));
                                                        }, children: configured ? t('keyReplace') : t('keyEnter') }), _jsx("button", { type: "button", className: cx(styles['keyAction'], styles['keyActionDanger']), disabled: disabled || locked || keyProfiles.length <= 1, onClick: () => { deleteKeyProfile(profile.ref); }, children: t('remove') })] })] }, profile.ref));
                                }), _jsx("button", { type: "button", className: styles['addKeyButton'], disabled: disabled, onClick: addKeyProfile, children: t('keyAdd') })] }), shownKeyFailure === undefined || editingRef !== null
                            ? null
                            : _jsx("p", { className: styles['error'], children: t(shownKeyFailure) })] }), props.credentialOnly === true ? null : _jsxs("details", { className: styles['customized'], children: [_jsx("summary", { className: styles['customizedSummary'], children: t('customized') }), _jsxs("div", { className: styles['customizedBody'], children: [ownsIdentity
                                    ? (_jsxs("div", { className: styles['field'], children: [_jsx("span", { className: styles['fieldLabel'], children: t('customDisplayName') }), _jsx("input", { className: styles['input'], type: "text", value: stringAt(draft, 'displayName') ?? '', 
                                                // What this route is called the moment the field is
                                                // cleared, which is the layer beneath the one this field
                                                // edits: a `cordis.yml` may pin a name for a route the
                                                // catalog does not ship, and only when nothing does is
                                                // the answer the route id. Reading the effective value
                                                // instead would echo the stored override back as the
                                                // thing clearing restores.
                                                placeholder: stringAt(schema.getPath(namespace.base, settingsPath), 'displayName')
                                                    ?? props.provider, "aria-label": t('customDisplayName'), disabled: disabled, onChange: (event) => { setField('displayName', event.target.value); } })] }))
                                    : null, _jsxs("div", { className: styles['field'], children: [_jsx("span", { className: styles['fieldLabel'], children: t('baseUrl') }), _jsx("input", { className: styles['input'], type: "text", value: stringAt(draft, 'baseURL') ?? '', placeholder: family === 'deepseek'
                                                ? t('deepSeekBaseUrl')
                                                : stringAt(fallback, 'baseURL') ?? t('baseUrlDefault'), "aria-describedby": family === 'deepseek' ? `${props.provider}-endpoint-hint` : undefined, "aria-label": t('baseUrl'), disabled: disabled, onChange: (event) => {
                                                setField('baseURL', event.target.value === '' ? undefined : event.target.value);
                                            } }), family === 'deepseek' ? _jsx("span", { id: `${props.provider}-endpoint-hint`, className: styles['advancedHint'], children: t('deepSeekEndpointHint') }) : null] }), ownsIdentity
                                    ? (_jsxs("div", { className: styles['field'], children: [_jsx("span", { className: styles['fieldLabel'], children: t('customApi') }), _jsxs("select", { className: `${styles['input']} ${styles['selectInput']}`, value: probeApi ?? '', "aria-label": t('customApi'), disabled: disabled, onChange: (event) => { setField('api', event.target.value); }, children: [probeApi === undefined ? _jsx("option", { value: "", children: t('customApiUnset') }) : null, protocols.map(choice => _jsx("option", { value: choice, children: protocolLabel(t, choice) }, choice))] })] }))
                                    : null, family === 'deepseek'
                                    ? (_jsx(DeepSeekModelsEditor, { ...catalogProps, defaultContextWindow: typeof defaultContextWindow === 'number'
                                            ? defaultContextWindow
                                            : undefined, defaultMaxTokens: typeof defaultMaxTokens === 'number' ? defaultMaxTokens : undefined }))
                                    : (_jsx(ModelListEditor, { ...catalogProps, catalogProvider: props.declared === true ? undefined : props.provider, defaultInput: Array.isArray(defaultInput) ? defaultInput : undefined, probe: probe, probeBlocked: activeKeyFailure, operations: operations, onBusyChange: setListBusy }))] })] })] }));
    };
    return (_jsxs("div", { className: props.credentialOnly === true ? styles['addBlock'] : styles['editor'], children: [props.hideTitle === true
                ? null
                : (_jsxs("div", { className: styles['editorHeader'], children: [_jsx("span", { className: styles['editorTitle'], children: props.displayName }), props.provider !== props.displayName
                            ? _jsx("span", { className: styles['editorRoute'], children: props.provider })
                            : null] })), layout === 'unknown'
                ? _jsx("p", { className: styles['advancedHint'], children: `${t('advancedHint')} (${namespace.ns})` })
                : curatedFields(layout), failure !== undefined ? _jsx("p", { className: styles['error'], children: failure }) : null, props.credentialOnly === true || modelFailure === undefined
                ? null
                : (_jsx("p", { className: styles['advancedHint'], children: `${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}` })), _jsx(EditorFooter, { t: t, busy: busy, submitDisabled: disabled || layout === 'unknown'
                    || (props.credentialOnly !== true && modelFailure !== undefined)
                    || anyKeyFailure
                    || credentialRequiredFailure !== undefined, submitLabelKey: props.submitLabelKey ?? 'apply', submitBusyLabelKey: props.submitBusyLabelKey ?? 'applying', ...props.cancelLabelKey === undefined ? {} : { cancelLabelKey: props.cancelLabelKey }, onCancel: () => { props.onClose(false); }, onSubmit: () => { props.onSubmitCredential?.(); void apply(); } })] }));
}
//# sourceMappingURL=ProviderEditor.js.map