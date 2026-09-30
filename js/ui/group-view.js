/**
 * group-view.js – Tab „Gruppe“: Raumcode und Einladung, Mitglieder, Helden.
 * Der Meister sieht alle Helden live, kann sie öffnen, zuweisen und löschen.
 */
import { h, setChildren } from './dom.js';
import { confirmDialog } from './dialog.js';
import { ROLE_NAMES, ROLES } from '../room.js';
import { heroName, normalizeHero, describeConditions } from '../sheet.js';

function formatCode(code) {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function vital(label, pool) {
  return h('span', { class: 'vital' }, h('small', {}, label), `${pool.current}/${pool.max}`);
}

function heroSummary(hero) {
  const conditions = describeConditions(hero);
  return [
    h(
      'div',
      { class: 'vitals' },
      vital('LE', hero.base.le),
      hero.base.asp.max > 0 ? vital('AsP', hero.base.asp) : null,
      hero.base.kap.max > 0 ? vital('KaP', hero.base.kap) : null,
      vital('SchiP', hero.base.schip),
    ),
    conditions ? h('p', { class: 'row-sub' }, `Zustände: ${conditions}`) : null,
  ];
}

/**
 * @param {HTMLElement} root
 * @param {object} options
 * @param {object} options.room      Observable { session, members, characters, live }
 * @param {() => string|null} options.currentCharacterId
 * @param {object} options.actions   { open(id), assign(characterId, userId), remove(id), leave(), share() }
 *        leave() fragt selbst nach; Zuweisen und Löschen werden hier bestätigt.
 */
export function createGroupView(root, { room, currentCharacterId, actions }) {
  function memberName(members, userId) {
    return members.find((member) => member.user_id === userId)?.display_name ?? 'niemand';
  }

  function assignSelect(character, members, characters) {
    const owners = new Set(characters.map((entry) => entry.owner_id));
    const candidates = members.filter((member) => !owners.has(member.user_id) || member.user_id === character.owner_id);
    return h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Gehört'),
      h(
        'select',
        {
          onchange: async (event) => {
            const userId = event.target.value;
            const target = memberName(members, userId);
            const question = `„${heroName(normalizeHero(character.data))}“ an ${target} übergeben?`;
            if (await confirmDialog(question, { confirmLabel: 'Übergeben' }))
              await actions.assign(character.id, userId);
            else event.target.value = character.owner_id ?? '';
          },
        },
        character.owner_id ? null : h('option', { value: '', selected: true }, 'niemand'),
        candidates.map((member) =>
          h(
            'option',
            { value: member.user_id, selected: member.user_id === character.owner_id },
            `${member.display_name} (${ROLE_NAMES[member.role]})`,
          ),
        ),
      ),
    );
  }

  function heroCard(character, { members, characters, isMaster }) {
    const hero = normalizeHero(character.data);
    const isOpen = character.id === currentCharacterId();
    return h(
      'article',
      { class: `hero-card ${isOpen ? 'is-open' : ''}`.trim() },
      h(
        'div',
        { class: 'hero-card-head' },
        h('strong', {}, heroName(hero)),
        h('span', { class: 'row-sub' }, `Spieler: ${memberName(members, character.owner_id)}`),
      ),
      heroSummary(hero),
      isMaster
        ? h(
            'div',
            { class: 'hero-card-actions' },
            h(
              'button',
              { type: 'button', class: 'btn btn-primary', onclick: () => actions.open(character.id) },
              isOpen ? 'Geöffnet' : 'Öffnen',
            ),
            assignSelect(character, members, characters),
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-danger-outline',
                onclick: async () => {
                  const question = `„${heroName(hero)}“ endgültig löschen? Das kann nicht rückgängig gemacht werden.`;
                  if (await confirmDialog(question, { confirmLabel: 'Löschen', danger: true }))
                    await actions.remove(character.id);
                },
              },
              'Löschen',
            ),
          )
        : null,
    );
  }

  function render() {
    const { session, members, characters, live } = room.get();
    const isMaster = session.role === ROLES.MASTER;
    const heroOwners = new Map(characters.map((character) => [character.owner_id, character]));

    setChildren(
      root,
      h(
        'section',
        { class: 'card' },
        h('h2', {}, session.name || 'Raum'),
        h(
          'div',
          { class: 'room-code' },
          h('span', { class: 'field-label' }, 'Raumcode'),
          h('strong', { class: 'room-code-value' }, formatCode(session.code)),
        ),
        h(
          'div',
          { class: 'button-row' },
          h('button', { type: 'button', class: 'btn', onclick: actions.share }, 'Einladung teilen'),
        ),
        h('p', {}, `Du bist als ${session.displayName} (${ROLE_NAMES[session.role]}) im Raum.`),
        h(
          'p',
          { class: `live-status ${live ? 'is-live' : ''}`.trim() },
          live ? 'Live verbunden – Änderungen erscheinen sofort.' : 'Keine Live-Verbindung.',
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, isMaster ? 'Helden im Raum' : 'Dein Held'),
        characters.length
          ? characters.map((character) => heroCard(character, { members, characters, isMaster }))
          : h(
              'p',
              { class: 'empty-hint' },
              isMaster ? 'Noch hat niemand einen Helden angelegt.' : 'Noch kein Held angelegt.',
            ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, `Mitglieder (${members.length})`),
        h(
          'ul',
          { class: 'member-list' },
          members.map((member) =>
            h(
              'li',
              {},
              h('span', {}, member.display_name, member.user_id === session.userId ? ' (du)' : ''),
              h(
                'span',
                { class: 'row-sub' },
                ROLE_NAMES[member.role],
                heroOwners.has(member.user_id)
                  ? ` · ${heroName(normalizeHero(heroOwners.get(member.user_id).data))}`
                  : '',
              ),
            ),
          ),
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-danger-outline leave-button',
          onclick: actions.leave,
        },
        'Raum verlassen',
      ),
    );
  }

  // Nicht neu zeichnen, während eine Auswahlliste offen ist (würde sie schließen) – danach nachholen.
  let pending = false;
  function renderWhenIdle() {
    if (document.activeElement?.tagName === 'SELECT' && root.contains(document.activeElement)) pending = true;
    else render();
  }
  root.addEventListener('focusout', () => {
    if (!pending) return;
    pending = false;
    setTimeout(render, 0);
  });

  room.subscribe(renderWhenIdle);
  render();
  return { render };
}
