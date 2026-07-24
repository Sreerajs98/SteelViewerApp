namespace SteelPackingApp.Models;

/// <summary>
/// One row from the AEM Shipping List = one assembly type (e.g. "CL001 - COLUMN").
/// Qty tells us how many physical pieces of this exact assembly need to be shipped.
/// </summary>
public class SteelItem
{
    public string AssmMark { get; set; } = "";
    public int Qty { get; set; }
    public string AssemblyName { get; set; } = "";

    public double LengthMm { get; set; }
    public double WidthMm { get; set; }
    public double HeightMm { get; set; }

    public double UnitWeightKg { get; set; }
    public double TotalWeightKg { get; set; }

    public string Remarks { get; set; } = "";

    /// <summary>
    /// Section profile description read from the IFC part's Description
    /// attribute (Tekla exports the section name here - e.g. "200Z18",
    /// "120C20", "L40*2.5", "PL6X500", "ROD12"). Empty when unavailable.
    /// Parsed on the JS side to decide the exact rendered cross-section.
    /// </summary>
    public string ProfileDesc { get; set; } = "";

    /// <summary>
    /// True when the weight came from a geometry-based estimate
    /// (bounding-box volume × steel density) rather than a real Tekla
    /// property set. The JS side reduces this by a shape-specific fill
    /// factor for thin-walled profiles like Z-purlins and C-channels,
    /// where the true steel volume is only ~2–15 % of the bounding box.
    /// </summary>
    public bool WeightEstimated { get; set; }

    public double LengthM => LengthMm / 1000.0;
}

/// <summary>
/// A single physical piece to load, expanded out from a SteelItem's Qty.
/// E.g. if CL001 has Qty=1 it produces one ShippableUnit; BR001 with Qty=2
/// produces two identical ShippableUnits (unit 1 of 2, unit 2 of 2).
/// </summary>
public class ShippableUnit
{
    public SteelItem Source { get; set; } = null!;
    public int UnitIndex { get; set; }   // 1-based, e.g. 1 of 2
}

public class JobInfo
{
    public string JobNo { get; set; } = "";
    public string BldgNo { get; set; } = "";
    public string PhaseNo { get; set; } = "";
    public string Customer { get; set; } = "";
}
