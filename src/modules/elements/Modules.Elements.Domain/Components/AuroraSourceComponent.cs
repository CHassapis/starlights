namespace Starlights.Modules.Elements.Domain.Components;

/// <summary>
/// Links an element to the Aurora element it was imported from, keeping the original XML
/// so nothing is lost while the Starlights model does not cover every Aurora feature yet.
/// </summary>
public sealed class AuroraSourceComponent : ElementComponentBase
{
    /// <summary>
    /// Initializes a new instance of the <see cref="AuroraSourceComponent"/> class.
    /// </summary>
    public AuroraSourceComponent(ElementId owningElement, string auroraId, string auroraType, string? source, string file, string rawXml)
        : base(owningElement)
    {
        AuroraId = auroraId.Trim();
        AuroraType = auroraType.Trim();
        Source = string.IsNullOrWhiteSpace(source) ? null : source.Trim();
        File = file;
        RawXml = rawXml;
    }

    /// <summary>
    /// Gets the Aurora element id, e.g. <c>ID_WOTC_PHB24_CLASS_FIGHTER</c>.
    /// </summary>
    public string AuroraId { get; private set; }

    /// <summary>
    /// Gets the element type as written in the Aurora XML, before it was mapped to a Starlights type.
    /// </summary>
    public string AuroraType { get; private set; }

    /// <summary>
    /// Gets the source book, e.g. "Player’s Handbook (2024)".
    /// </summary>
    public string? Source { get; private set; }

    /// <summary>
    /// Gets the XML file the element was read from, relative to the content repository root.
    /// </summary>
    public string File { get; private set; }

    /// <summary>
    /// Gets the original &lt;element&gt; XML.
    /// </summary>
    public string RawXml { get; private set; }
}
