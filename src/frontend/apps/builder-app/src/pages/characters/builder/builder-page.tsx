import { ArrowLeftIcon, ChurchIcon, FileTextIcon, ImageIcon, InfoIcon, MinusIcon, PlusIcon, ScaleIcon, ScrollTextIcon, SparklesIcon, SwordsIcon, UserIcon, UsersIcon } from "lucide-react";
import { useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ElementPanel } from "@/components/element-panel";
import { SearchSelect } from "@/components/search-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useAssignPlayer,
  useRemovePortrait,
  useBuilderChoices,
  useCharacterClassList,
  useCharacterHeader,
  useChoiceOptions,
  useClearChoice,
  usePickChoice,
  useSetClassLevel,
  type BuilderChoice,
} from "@/lib/api/builder";
import { usePlayer } from "@/lib/player";
import { firstImage, usePictureDrop, usePortraitUpload } from "@/lib/picture-drop";
import { SourcesPicker } from "@/components/sources-picker";
import { StoryTab } from "./story-tab";
import { AbilitiesTab } from "./abilities-tab";
import { EquipmentTab } from "./equipment-tab";
import { editionOf, restrictedForEdition, useCharacterSources, useSetCharacterSources, useSources } from "@/lib/api/sources";
import { EditionPicker } from "@/components/edition-picker";
import { cn } from "@/lib/utils";

const SECTION_ORDER = ["Class", "Species", "Background", "Alignment", "Deity"];
const SECTION_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Class: SwordsIcon,
  Species: UsersIcon,
  Background: ScrollTextIcon,
  Alignment: ScaleIcon,
  Deity: ChurchIcon,
};

export function CharacterBuilderPage() {
  const { id = "" } = useParams();
  const isMobile = useIsMobile();
  const { data: choicesData, isLoading } = useBuilderChoices(id);
  const header = useCharacterHeader(id);

  const [preview, setPreview] = useState<string | null>(null); // option under the pointer in an open list
  const [focus, setFocus] = useState<string | null>(null); // last picked or inspected element
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const sections = useMemo(() => {
    const bySection = new Map<string, BuilderChoice[]>();
    for (const choice of choicesData?.choices ?? []) {
      if (!bySection.has(choice.section)) bySection.set(choice.section, []);
      bySection.get(choice.section)!.push(choice);
    }
    const rank = (s: string) => (SECTION_ORDER.includes(s) ? SECTION_ORDER.indexOf(s) : SECTION_ORDER.length);
    return [...bySection.entries()].sort(([a], [b]) => rank(a) - rank(b));
  }, [choicesData]);

  function inspect(elementId: string) {
    setFocus(elementId);
    if (isMobile) setDrawerId(elementId);
  }

  if (header.isError) {
    const locked = (header.error as { status?: number }).status === 401;
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <p className="text-muted-foreground">
          {locked
            ? "This character belongs to a player who locked their characters with a password. Pick that player (and enter the password) to open it."
            : "This character does not exist (any more)."}
        </p>
        <Link to="/characters" className="mt-4 inline-block underline">
          Back to the characters
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 px-4 py-8 pb-24">
      <BuilderHeader characterId={id} choices={choicesData?.choices ?? []} pending={choicesData?.pending ?? false} />

      <Tabs defaultValue="build">
        <TabsList>
          <TabsTrigger value="build">Build</TabsTrigger>
          <TabsTrigger value="abilities">Abilities</TabsTrigger>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          <TabsTrigger value="story">Story</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
        </TabsList>

        <TabsContent value="abilities" className="mt-4">
          <AbilitiesTab characterId={id} />
        </TabsContent>

        <TabsContent value="equipment" className="mt-4">
          <EquipmentTab characterId={id} />
        </TabsContent>

        <TabsContent value="story" className="mt-4">
          <StoryTab characterId={id} />
        </TabsContent>

        <TabsContent value="sources" className="mt-4 max-w-3xl">
          <SourcesTab characterId={id} />
        </TabsContent>

        <TabsContent value="build" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
            <div className="space-y-4">
              {isLoading && <Spinner className="mx-auto my-12 size-6" />}
              {sections.map(([section, choices]) => (
                <SectionCard key={section} section={section} choices={choices}>
                  {choices.map((choice) => (
                    <ChoiceRow
                      key={choice.ruleId}
                      characterId={id}
                      choice={choice}
                      hideLabel={choice.depth === 0 && choice.name === section}
                      onHighlight={setPreview}
                      onPicked={setFocus}
                      onInspect={inspect}
                    />
                  ))}
                </SectionCard>
              ))}
            </div>

            <aside className="hidden lg:block">
              <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg border bg-background/60 p-5">
                <ElementPanel
                  id={preview ?? focus}
                  emptyHint="Open a list and point at an option to read about it here, or use the ⓘ button next to a pick."
                />
              </div>
            </aside>
          </div>
        </TabsContent>
      </Tabs>

      <Drawer open={drawerId !== null} onOpenChange={(open) => !open && setDrawerId(null)}>
        <DrawerContent>
          <DrawerHeader className="sr-only">
            <DrawerTitle>Description</DrawerTitle>
          </DrawerHeader>
          <div className="max-h-[75vh] overflow-y-auto px-4 pb-8">
            <ElementPanel id={drawerId} />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function BuilderHeader({ characterId, choices, pending }: { characterId: string; choices: BuilderChoice[]; pending: boolean }) {
  const { player } = usePlayer();
  const { data: headerData } = useCharacterHeader(characterId);
  const { data: classData } = useCharacterClassList(characterId);
  const setLevel = useSetClassLevel(characterId);
  const assignPlayer = useAssignPlayer(characterId);

  const character = headerData?.character;
  const primary = classData?.classes.find((c) => c.isPrimary) ?? classData?.classes[0];
  const pick = (section: string) => choices.find((c) => c.section === section && c.depth === 0)?.selected?.name;
  const summary = [pick("Species"), primary ? `${primary.name} ${primary.level}` : null, pick("Background")].filter(Boolean).join(" · ");
  const owner = character?.playerName;

  function changeLevel(newLevel: number) {
    if (!primary) return;
    setLevel.mutate(
      { characterClassId: primary.characterClassId, newLevel },
      { onError: (e) => toast.error("Could not change the level", { description: e.message }) },
    );
  }

  return (
    <header className="space-y-3">
      <Link to="/characters" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Characters
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
        <PortraitEditor characterId={characterId} url={character?.portraitUrl} />
        <div className="min-w-0">
          <h1 className="truncate font-heading text-3xl tracking-wide">{character?.name ?? "…"}</h1>
          <p className="text-muted-foreground">{summary || "Pick a class, species and background to get started."}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <UserIcon className="size-4" />
            {owner ? `Player: ${owner}` : "No player"}
            {player && owner?.toLowerCase() !== player.toLowerCase() && (
              <Button variant="outline" size="sm" className="h-7" disabled={assignPlayer.isPending} onClick={() => assignPlayer.mutate(player)}>
                Move to {player}
              </Button>
            )}
          </p>
        </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" asChild>
            <Link to={`/characters/${characterId}/sheet`}>
              <FileTextIcon /> Character sheet
            </Link>
          </Button>
          {(pending || setLevel.isPending) && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" /> Updating…
            </span>
          )}
          <div className="flex items-center gap-2 rounded-lg border px-2 py-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Level down"
              disabled={!primary || primary.level <= 1 || setLevel.isPending}
              onClick={() => changeLevel(primary!.level - 1)}
            >
              <MinusIcon />
            </Button>
            <div className="w-16 text-center">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Level</div>
              <div className="font-heading text-xl">{primary?.level ?? "–"}</div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Level up"
              disabled={!primary || primary.level >= 20 || setLevel.isPending}
              onClick={() => changeLevel(primary!.level + 1)}
            >
              <PlusIcon />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

function SectionCard({ section, choices, children }: { section: string; choices: BuilderChoice[]; children: ReactNode }) {
  const Icon = SECTION_ICONS[section] ?? SparklesIcon;
  const open = choices.filter((c) => !c.selected && !c.optional).length;

  return (
    <section className="rounded-lg border bg-background/60">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Icon className="size-5 text-muted-foreground" />
        <h2 className="font-heading text-lg tracking-wide">{section}</h2>
        {open > 0 ? (
          <Badge variant="secondary" className="ms-auto">
            {open} to choose
          </Badge>
        ) : (
          choices.every((c) => c.optional && !c.selected) && (
            <Badge variant="outline" className="ms-auto">
              optional
            </Badge>
          )
        )}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function ChoiceRow({
  characterId,
  choice,
  hideLabel,
  onHighlight,
  onPicked,
  onInspect,
}: {
  characterId: string;
  choice: BuilderChoice;
  hideLabel: boolean;
  onHighlight: (id: string | null) => void;
  onPicked: (id: string) => void;
  onInspect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const optionsQuery = useChoiceOptions(characterId, choice.ruleId, open);
  const pickChoice = usePickChoice(characterId);
  const clearChoice = useClearChoice(characterId);
  const busy = pickChoice.isPending || clearChoice.isPending;

  const options = useMemo(
    () => optionsQuery.data?.options.map((o) => ({ id: o.elementId, name: o.name, hint: o.source })),
    [optionsQuery.data],
  );

  const meta = [
    choice.slots > 1 ? `${choice.slot} of ${choice.slots}` : null,
    choice.level > 0 ? `level ${choice.level}` : null,
    choice.depth > 0 && !choice.name.includes(choice.parentName) ? `from ${choice.parentName}` : null,
  ].filter(Boolean);

  return (
    <div
      className={cn("flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4", choice.depth > 0 && "border-l-2 pl-3")}
      style={choice.depth > 1 ? { marginLeft: `${(choice.depth - 1) * 1}rem` } : undefined}
    >
      {!hideLabel && (
        <div className="min-w-0 shrink-0 sm:w-60">
          <div className="truncate text-sm font-medium" title={choice.name}>
            {choice.name}
          </div>
          {meta.length > 0 && <div className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</div>}
        </div>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <SearchSelect
          value={choice.selected?.elementId}
          valueLabel={choice.selected?.name}
          valueHint={choice.selected?.source}
          options={options}
          loading={optionsQuery.isLoading}
          placeholder={`Choose ${choice.type.toLowerCase()}…`}
          disabled={busy}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) onHighlight(null);
          }}
          onHighlight={onHighlight}
          onSelect={(elementId) => {
            onPicked(elementId);
            pickChoice.mutate(
              { choice, elementId },
              { onError: (e) => toast.error(`Could not pick for ${choice.name}`, { description: e.message }) },
            );
          }}
          onClear={() =>
            clearChoice.mutate(choice, { onError: (e) => toast.error(`Could not clear ${choice.name}`, { description: e.message }) })
          }
        />
        {busy ? (
          <Spinner className="mx-2 size-4 shrink-0" />
        ) : (
          choice.selected && (
            <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label={`About ${choice.selected.name}`} onClick={() => onInspect(choice.selected!.elementId)}>
              <InfoIcon />
            </Button>
          )
        )}
      </div>
    </div>
  );
}

function SourcesTab({ characterId }: { characterId: string }) {
  const { data: sourceData, isLoading } = useSources();
  const { data: characterSources } = useCharacterSources(characterId);
  const setSources = useSetCharacterSources(characterId);

  const save = (restricted: string[]) =>
    setSources.mutate(restricted, { onError: (e) => toast.error("Could not save the sources", { description: e.message }) });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Which rules does this character use?</p>
      <EditionPicker
        value={sourceData && characterSources ? editionOf(characterSources.restricted, sourceData.sources) : null}
        onChange={(edition) => sourceData && save(restrictedForEdition(edition, sourceData.sources))}
      />
      <p className="pt-3 text-sm text-muted-foreground">
        Or tick the books yourself. The dropdowns only offer content from ticked books; picks you already made stay.
      </p>
      <SourcesPicker
        sources={sourceData?.sources}
        restricted={characterSources?.restricted ?? []}
        loading={isLoading || !characterSources}
        onChange={save}
      />
    </div>
  );
}

/** The character's portrait: drop a picture on it or click it to choose one (shrunk in the browser first). */
function PortraitEditor({ characterId, url }: { characterId: string; url?: string | null }) {
  const upload = usePortraitUpload(characterId);
  const remove = useRemovePortrait(characterId);
  const input = useRef<HTMLInputElement>(null);
  const busy = upload.isPending || remove.isPending;
  const { over, handlers } = usePictureDrop(upload.send);

  return (
    <div
      {...handlers}
      className={cn(
        "group relative size-24 shrink-0 overflow-hidden rounded-xl border-4 border-double bg-muted sm:size-28",
        over && "border-primary ring-4 ring-primary/40",
      )}
    >
      {url ? (
        <img src={url} alt="Portrait" className="size-full object-cover" />
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex size-full flex-col items-center justify-center gap-1 px-1 text-center text-xs text-muted-foreground hover:text-foreground"
        >
          <ImageIcon className="size-6" />
          Add portrait
          <span className="text-[10px] leading-tight">drop a picture or click</span>
        </button>
      )}
      {url && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 bg-black/70 py-1 text-xs text-white sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
          <button type="button" onClick={() => input.current?.click()} className="hover:underline">
            Change
          </button>
          <button type="button" onClick={() => remove.mutate()} className="hover:underline">
            Remove
          </button>
        </div>
      )}
      {over && <div className="absolute inset-0 flex items-center justify-center bg-primary/30 text-xs font-medium text-white">Drop it</div>}
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <Spinner className="size-5 text-white" />
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = firstImage(e.target.files);
          e.target.value = "";
          if (file) upload.send(file);
        }}
      />
    </div>
  );
}
