using SteelPackingApp.Models;

namespace SteelPackingApp.Services;

/// <summary>
/// Exports the RAW item list (not pre-arranged) so the 3D viewer can run its
/// own packing algorithms client-side - both a quick preview layout and a
/// real space+weight optimizer, triggered by buttons in the browser. This
/// keeps all packing logic in one place (the viewer) and works for any job's
/// item list without any per-job code here.
/// </summary>
public static class SceneBuilder
{
    public static RawScene BuildRawScene(JobInfo job, Container spec, List<SteelItem> items)
    {
        var scene = new RawScene
        {
            JobNo = job.JobNo,
            BldgNo = job.BldgNo,
            PhaseNo = job.PhaseNo,
            Customer = job.Customer,
            ContainerSpec = new ContainerSpecDto
            {
                LengthMm = spec.LengthMm,
                WidthMm = spec.WidthMm,
                HeightMm = spec.HeightMm,
                MaxWeightKg = spec.MaxWeightKg
            }
        };

        foreach (var item in items)
        {
            scene.Items.Add(new RawItem
            {
                Mark = item.AssmMark,
                AssemblyName = item.AssemblyName,
                Category = ShapeCategorizer.Categorize(item.AssemblyName),
                LengthMm = item.LengthMm,
                WidthMm = item.WidthMm,
                HeightMm = item.HeightMm,
                Qty = item.Qty,
                UnitWeightKg = item.UnitWeightKg,
                ProfileDesc = item.ProfileDesc,
                WeightEstimated = item.WeightEstimated
            });
        }

        return scene;
    }
}

public class RawScene
{
    public string JobNo { get; set; } = "";
    public string BldgNo { get; set; } = "";
    public string PhaseNo { get; set; } = "";
    public string Customer { get; set; } = "";
    public ContainerSpecDto ContainerSpec { get; set; } = new();
    public List<RawItem> Items { get; set; } = new();
}

public class ContainerSpecDto
{
    public double LengthMm { get; set; }
    public double WidthMm { get; set; }
    public double HeightMm { get; set; }
    public double MaxWeightKg { get; set; }
}

public class RawItem
{
    public string Mark { get; set; } = "";
    public string AssemblyName { get; set; } = "";
    public string Category { get; set; } = "other";
    public double LengthMm { get; set; }
    public double WidthMm { get; set; }
    public double HeightMm { get; set; }
    public int Qty { get; set; }
    public double UnitWeightKg { get; set; }
    public string ProfileDesc { get; set; } = "";
    public bool WeightEstimated { get; set; }
}
