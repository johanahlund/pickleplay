/**
 * Cheap first-name → gender heuristic, PT-leaning. Returns "M", "F", or
 * null when we shouldn't guess. The paste-list flow surfaces the guess
 * but always lets the organizer override per row.
 */
const MALE = new Set([
  "alberto", "alex", "alexandre", "andre", "antonio", "armando", "artur",
  "bernardo", "bruno", "carlos", "clive", "cristiano", "daniel", "david",
  "dinis", "diogo", "duarte", "eduardo", "fabio", "felipe", "fernando",
  "filipe", "francisco", "frederico", "gabriel", "goncalo", "guilherme",
  "gustavo", "henrique", "hugo", "ivan", "jaime", "javier", "jeff",
  "joao", "joaquim", "joel", "johan", "jorge", "jose", "leonardo",
  "luis", "luiz", "manuel", "marco", "marcos", "mario", "martim",
  "mateus", "matheus", "miguel", "nuno", "oscar", "pablo", "paulo",
  "pedro", "rafael", "ricardo", "roberto", "rodrigo", "rogerio", "rui",
  "salvador", "samuel", "sergio", "simao", "thiago", "tiago", "tomas",
  "valter", "vasco", "vitor", "vicente", "vinicius",
]);

const FEMALE = new Set([
  "alexandra", "alice", "ana", "andrea", "andreia", "antonia", "barbara",
  "beatriz", "carla", "carolina", "catarina", "cecilia", "clara", "claudia",
  "constanca", "cristina", "daniela", "debora", "diana", "elena", "elsa",
  "ester", "eva", "fatima", "filipa", "francisca", "gabriela", "helena",
  "ines", "irene", "isabel", "joana", "julia", "juliana", "laura",
  "leonor", "lia", "liliana", "lucia", "luisa", "luiza", "madalena",
  "manuela", "margarida", "maria", "mariana", "marina", "marta", "matilde",
  "melissa", "mercedes", "monica", "natalia", "olivia", "patricia",
  "paula", "raquel", "rita", "rosa", "salome", "sandra", "sara",
  "sofia", "sonia", "susana", "tatiana", "teresa", "vanessa", "vera",
  "veronica", "vitoria",
]);

function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function inferGender(name: string): "M" | "F" | null {
  const first = normalize(name.split(/\s+/)[0] || "");
  if (!first) return null;
  if (MALE.has(first)) return "M";
  if (FEMALE.has(first)) return "F";
  return null;
}
