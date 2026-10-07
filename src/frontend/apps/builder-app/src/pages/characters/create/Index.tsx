import { useCharacterCreationOptions, useCharacterPortraitOptions, useCreateCharacter, type CharacterPortraitOption } from "@/lib/api/characters/queries";
import { CharacterCreationOptionsSelect } from "./character-creation-options-select";
import { useEffect, useMemo, useState } from "react";
import { SourcesPicker } from "@/components/sources-picker";
import { apiClient } from "@/lib/api-client";
import { shrinkImage } from "@/lib/image";
import { firstImage, usePictureDrop } from "@/lib/picture-drop";
import { UploadIcon } from "lucide-react";
import { editionOf, restrictedForEdition, useSources } from "@/lib/api/sources";
import { EditionPicker } from "@/components/edition-picker";
import { CheckIcon, OctagonAlertIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSeparator, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CardWrapper } from "../components/card-wrapper";
import { usePlayer } from "@/lib/player";
import { PlayerGate } from "../player-picker";

function PortraitsLoading() {
  return (
    <Empty className="size-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Spinner />
        </EmptyMedia>
        <EmptyDescription>The portraits are loading.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function PortraitsError({ errorMessage }: { errorMessage: string }) {
  return (
    <Empty className="">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <OctagonAlertIcon className="text-destructive" />
        </EmptyMedia>
        <EmptyDescription>{errorMessage}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
const schema = z.object({
  CharacterCreationOptionId: z.string().min(1, "Please select an option"),
  Name: z.string().trim().min(1, "Please enter a name"),
  PortraitUrl: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

function CharacterCreation() {
  const { data: options, isLoading: optionsLoading, isError: optionsIsError, error: optionsError } = useCharacterCreationOptions();
  const { data: portraits, isLoading: portraitsLoading, isError: portraitsIsError, error: portraitsError } = useCharacterPortraitOptions();
  const navigate = useNavigate();
  const createMutation = useCreateCharacter();
  const { player } = usePlayer();
  const { data: sourceData, isLoading: sourcesLoading } = useSources();
  const [restricted, setRestricted] = useState<string[] | null>(null);
  const [uploadedPortrait, setUploadedPortrait] = useState<string | null>(null);
  const [guided, setGuided] = useState(true);
  useEffect(() => {
    if (sourceData && restricted === null) setRestricted(restrictedForEdition("mixed", sourceData.sources));
  }, [sourceData, restricted]);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isValid, isSubmitting },
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      CharacterCreationOptionId: "",
      Name: "",
      PortraitUrl: undefined,
    },
  });

  async function takeOwnPortrait(file: File) {
    try {
      setUploadedPortrait(await shrinkImage(file));
      setValue("PortraitUrl", undefined, { shouldValidate: true });
    } catch (err) {
      toast.error("Could not read that picture", { description: (err as Error).message });
    }
  }
  const portraitDrop = usePictureDrop(takeOwnPortrait);

  // with a single creation option there is nothing to choose
  useEffect(() => {
    if (options?.options.length === 1) setValue("CharacterCreationOptionId", options.options[0].id, { shouldValidate: true });
  }, [options, setValue]);

  const selectedPortrait = watch("PortraitUrl");
  const canSubmit = useMemo(() => isValid && !createMutation.isPending && !isSubmitting, [isValid, createMutation.isPending, isSubmitting]);

  const onSubmit = handleSubmit(async (values) => {
    const payload = { ...values, PlayerName: player ?? undefined, RestrictedSources: restricted ?? [] };
    const result = (await createMutation.mutateAsync(payload as typeof values)) as { id?: string; Id?: string };
    const newId = result?.id ?? result?.Id;
    if (newId && uploadedPortrait) {
      await apiClient.post(`/api/characters/${newId}/portrait`, { data: uploadedPortrait }).catch(() => {});
    }
    if (newId) navigate(guided ? `/characters/${newId}?guide=1` : `/characters/${newId}`);
  });

  return (
    <form className="flex min-w-0 flex-col gap-6" onSubmit={onSubmit}>
      {/* min-w-0: a fieldset is never narrower than its widest content by default, which pushed the form off a phone's screen */}
      <FieldSet className="min-w-0">
        {/* <FieldLegend>Character</FieldLegend>
        <FieldDescription>Fill in your character information. You can change all these fields later.</FieldDescription>
        <FieldSeparator /> */}
        <Field>
          <FieldContent>
            <FieldLabel>Rules</FieldLabel>
            <FieldDescription>Are you playing with the 2014 rules, the 2024 rules, or both mixed?</FieldDescription>
          </FieldContent>
          <EditionPicker
            value={sourceData && restricted ? editionOf(restricted, sourceData.sources) : "mixed"}
            onChange={(edition) => sourceData && setRestricted(restrictedForEdition(edition, sourceData.sources))}
          />
        </Field>
        <FieldSeparator />
        <Field>
          <FieldContent>
            <FieldLabel>Sources</FieldLabel>
            <FieldDescription>Tick the books you're using. The builder only offers content from these; you can change this later.</FieldDescription>
          </FieldContent>
          <SourcesPicker sources={sourceData?.sources} restricted={restricted ?? []} onChange={setRestricted} loading={sourcesLoading} />
        </Field>
        <FieldSeparator />
        <FieldGroup>
          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel>Character Creation Option</FieldLabel>
              <FieldDescription>
                This option determines your character's starting abilities and traits, this can vary based on the system or campaign you are playing.
              </FieldDescription>
            </FieldContent>
            <div className="md:min-w-80">
              {optionsLoading && <Spinner className="m-2" />}
              {optionsIsError && (
                <p className="text-sm flex items-center gap-2">
                  <OctagonAlertIcon className="text-destructive" /> Failed to load character options: {optionsError.message}
                </p>
              )}
              {options && (
                <>
                  <CharacterCreationOptionsSelect
                    characterCreationOptions={options}
                    onValueChange={(v) => setValue("CharacterCreationOptionId", v, { shouldValidate: false })}
                  />
                  {errors.CharacterCreationOptionId && <p className="text-sm text-destructive-600 mt-1">{errors.CharacterCreationOptionId.message}</p>}
                </>
              )}
            </div>
          </Field>
        </FieldGroup>
        <FieldSeparator />
        <FieldGroup>
          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor="charactername">Name</FieldLabel>
              <FieldDescription>Choose a unique name for your character.</FieldDescription>
            </FieldContent>
            <Input id="charactername" type="text" placeholder="The Nameless One" required {...register("Name")} className="md:min-w-80" />
          </Field>
        </FieldGroup>
        <FieldSeparator />
        <Field>
          <FieldContent>
            <FieldLabel>Portrait</FieldLabel>
            <FieldDescription>Upload your own picture or pick one of these.</FieldDescription>
          </FieldContent>
          <div className="max-h-72 overflow-y-auto rounded-md border border-dashed">
            <div className="p-2">
              {portraitsLoading && <PortraitsLoading />}
              {portraitsIsError && <PortraitsError errorMessage={portraitsError.message} />}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-12">
                <label
                  {...portraitDrop.handlers}
                  className={cn("relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded border border-dashed text-center text-xs text-muted-foreground hover:ring-2 hover:ring-tertiary", {
                    "ring-2 ring-tertiary": uploadedPortrait !== null,
                    "ring-4 ring-primary bg-primary/10": portraitDrop.over,
                  })}
                >
                  {uploadedPortrait ? (
                    <img className="size-full object-cover" src={uploadedPortrait} alt="Your portrait" />
                  ) : (
                    <>
                      <UploadIcon className="size-5" />
                      Upload your own
                      <span className="text-[10px] leading-tight">or drop it here</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const file = firstImage(e.target.files);
                      e.target.value = "";
                      if (file) takeOwnPortrait(file);
                    }}
                  />
                </label>
                {portraits &&
                  portraits.portraits.map((portrait: CharacterPortraitOption, index: number) => (
                    <div
                      className={cn("overflow-hidden rounded relative hover:ring-2 hover:ring-tertiary transition-all", {
                        "ring-2 ring-tertiary": selectedPortrait === portrait.url,
                      })}
                      key={index}
                      onClick={() => {
                        setUploadedPortrait(null);
                        setValue("PortraitUrl", portrait.url, { shouldValidate: true });
                      }}
                    >
                      <img className="size-full aspect-square object-cover" src={portrait.url} alt={portrait.description} title={portrait.description} />
                      {selectedPortrait === portrait.url && (
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                          <CheckIcon className="text-tertiary-200" size={36} />
                        </div>
                      )}
                    </div>
                  ))}
              </div>
              {errors.PortraitUrl && <p className="text-sm text-red-600 mt-1">{errors.PortraitUrl.message}</p>}
            </div>
          </div>
        </Field>
        <FieldSeparator />
      </FieldSet>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={guided} onChange={(e) => setGuided(e.target.checked)} />
        <span>
          <span className="font-medium">Guide me step by step</span>
          <span className="block text-xs text-muted-foreground">Recommended if you're new: class, species, background, ability scores, the books' starting equipment and spells, one at a time. Untick to go straight to the full builder.</span>
        </span>
      </label>
      <div className="flex items-center justify-start gap-3">
        <Button type="submit" variant="default" disabled={!canSubmit} className="w-full sm:w-auto">
          {createMutation.isPending || isSubmitting ? "Creating..." : "Create Character"}
        </Button>
        {createMutation.isError && <p className="text-sm text-destructive-600">{createMutation.error?.message}</p>}
      </div>
    </form>
  );
}

export default function CharactersCreatePage() {
  return (
    <>
      <div className="container mx-auto mt-4 px-4 sm:mt-12">
        <CardWrapper className="">
          <Card className="rounded-lg">
            <CardHeader className="border-b px-4 sm:px-6">
              <CardTitle>New Character</CardTitle>
              <CardDescription>Fill in your character information. You can change all these fields later.</CardDescription>
            </CardHeader>
            <CardContent className="px-4 sm:px-6">
              <PlayerGate>
                <CharacterCreation />
              </PlayerGate>
            </CardContent>
          </Card>
        </CardWrapper>
      </div>
      {/* <PageContent>
        <div className="flex-row md:flex gap-2">
          <ProseSection className="flex-grow">
            <h1 className="mb-0">Create New Character</h1>
            <p className="mt-0">Use the form below to create a new character for your adventures.</p>
          </ProseSection>
        </div>
      </PageContent> */}

      {/* <PageContent>
        <CharacterCreation />
      </PageContent> */}

      {/* <div className="flex-row md:flex gap-2">
        <ProseSection className="flex-grow">
          <h1 className="mb-0">Create New Character</h1>
          <p className="mt-0">Use the form below to create a new character for your adventures.</p>
        </ProseSection>
      </div>

      <hr className="my-4" />

      <Card className="mb-4">
        <CardContent>
          <CharacterCreation />
        </CardContent>
      </Card> */}
    </>
  );
}
