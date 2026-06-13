// Page archetype primitives — see the design overhaul plan (docs/design-overhaul-plan.md).
// LIST: ListPage / List / ListItem.  EDIT: EditPage / FormCard.  DETAIL: DetailPage.
// DetailPage renders the bold green AppHeader hero; pages adopting it must be
// added to Header.tsx's hidden-route list so the global header doesn't double up.
export { ListPage, List, ListItem } from "./ListPage";
export { EditPage, FormCard } from "./EditPage";
export { DetailPage } from "./DetailPage";
