using SteelPackingApp.Models;

namespace SteelPackingApp.Services;

/// <summary>
/// Reads a Tekla-exported IFC file directly (via StepParser - no xBIM, no
/// external IFC toolkit) and produces the same List&lt;SteelItem&gt; the
/// Excel-based flow produces, so it can go through the exact same
/// SceneBuilder/packing/3D-view pipeline afterwards.
///
/// What this looks for, per real shippable assembly (IfcElementAssembly):
///   - "ACERO_DATA" property set  -> ASSEMBLY_MARK, ASSEMBLY_NAME, PHASE
///   - "Tekla Assembly" property set -> "Assembly/Cast unit weight" (the
///     real total weight, already including welded-on plates/stiffeners)
///   - Its main structural part's "Tekla Quantity" property set -> real
///     Height/Width/Length in mm, computed by Tekla itself.
/// Bolts/washers (IfcMechanicalFastener) are skipped when picking the main
/// part - they ship attached to the assembly, not as separate pieces.
///
/// One IFC file can span an entire building across MULTIPLE phases (unlike
/// a Shipping List Excel, which is already scoped to one phase) - call
/// ListPhases first and let the person pick which phase they're shipping.
/// </summary>
public static class IfcAssemblyReader
{
    private class PropertySet
    {
        public string Name = "";
        public Dictionary<string, object?> Props = new();
    }

    public static List<double> ListPhases(string ifcPath)
    {
        var entities = StepParser.TokenizeEntities(File.ReadAllText(ifcPath));
        var (psets, entityToPsets, _) = BuildIndices(entities);

        var phases = new HashSet<double>();
        foreach (var kvp in entities)
        {
            if (kvp.Value.Type != "IFCELEMENTASSEMBLY") continue;
            var acero = GetPsetByName(kvp.Key, "ACERO_DATA", entityToPsets, psets);
            if (acero.TryGetValue("PHASE", out var ph) && ph is double d) phases.Add(d);
        }
        return phases.OrderBy(x => x).ToList();
    }

    public static (JobInfo job, List<SteelItem> items, int skippedNoMainPart) Convert(string ifcPath, double? phaseFilter)
    {
        string text = File.ReadAllText(ifcPath);
        var entities = StepParser.TokenizeEntities(text);
        var (psets, entityToPsets, entityToParts) = BuildIndices(entities);

        string jobNo = "";
        foreach (var kvp in entities)
        {
            if (kvp.Value.Type != "IFCPROJECT") continue;
            var args = StepParser.SplitTopLevel(kvp.Value.ArgsRaw);
            if (args.Count > 2) jobNo = StepParser.Unwrap(args[2]) as string ?? "";
            break;
        }

        var items = new List<SteelItem>();
        int skipped = 0;

        // Different Tekla export configurations name property sets slightly
        // differently. Rather than assume one fixed set of names, each piece
        // of data is looked up through a short list of candidates, in order
        // of how reliable/specific they are - the first one that actually
        // has a value wins.
        string[] markCommonPsets = { "Pset_ColumnCommon", "Pset_BeamCommon", "Pset_MemberCommon", "Pset_PlateCommon" };

        foreach (var kvp in entities)
        {
            if (kvp.Value.Type != "IFCELEMENTASSEMBLY") continue;
            int eid = kvp.Key;

            var acero = GetPsetByName(eid, "ACERO_DATA", entityToPsets, psets);
            var teklaAsm = GetPsetByName(eid, "Tekla Assembly", entityToPsets, psets);

            var args = StepParser.SplitTopLevel(kvp.Value.ArgsRaw);
            string? nameAttr = args.Count > 2 ? StepParser.Unwrap(args[2]) as string : null;

            double? phase = (acero.TryGetValue("PHASE", out var phObj) && phObj is double phd) ? phd : null;
            if (phaseFilter.HasValue && phase != phaseFilter.Value) continue;

            var partIds = entityToParts.TryGetValue(eid, out var pl) ? pl : new List<int>();
            var nonFastenerParts = partIds
                .Where(pid => entities.TryGetValue(pid, out var p) && p.Type != "IFCMECHANICALFASTENER")
                .ToList();

            // --- Mark: ACERO_DATA -> Tekla Assembly mark -> a part's own
            // "Reference" property (Pset_*Common) -> the assembly's own Name
            // attribute -> entity id as a last resort so nothing is silently
            // dropped just because it lacks a mark.
            string? mark = (acero.TryGetValue("ASSEMBLY_MARK", out var m1) ? m1 as string : null)
                ?? (teklaAsm.TryGetValue("Assembly/Cast unit Mark", out var m2) ? m2 as string : null);

            if (string.IsNullOrWhiteSpace(mark))
            {
                foreach (var pid in nonFastenerParts)
                {
                    foreach (var psetName in markCommonPsets)
                    {
                        var pset = GetPsetByName(pid, psetName, entityToPsets, psets);
                        if (pset.TryGetValue("Reference", out var refVal) && refVal is string refStr && !string.IsNullOrWhiteSpace(refStr))
                        {
                            mark = refStr;
                            break;
                        }
                    }
                    if (mark != null) break;
                }
            }
            mark ??= nameAttr ?? $"ASM-{eid}";

            string name = (acero.TryGetValue("ASSEMBLY_NAME", out var n1) ? n1 as string : null)
                ?? nameAttr ?? "UNKNOWN";

            // --- Weight: assembly-level total -> sum of each part's own
            // weight (Tekla Quantity, then BaseQuantities) as a fallback so
            // a missing assembly-level rollup doesn't zero out the weight.
            double weight = (teklaAsm.TryGetValue("Assembly/Cast unit weight", out var w) && w is double wd) ? wd : 0;
            if (weight <= 0)
            {
                double summed = 0;
                foreach (var pid in nonFastenerParts)
                {
                    var tq = GetPsetByName(pid, "Tekla Quantity", entityToPsets, psets);
                    if (tq.TryGetValue("Weight", out var pw) && pw is double pwd) { summed += pwd; continue; }
                    var bq = GetPsetByName(pid, "BaseQuantities", entityToPsets, psets);
                    if (bq.TryGetValue("NetWeight", out var nw) && nw is double nwd) summed += nwd;
                }
                if (summed > 0) weight = summed;
            }

            // --- Dimensions: pick the longest non-fastener part by Length,
            // preferring "Tekla Quantity" but falling back to "BaseQuantities"
            // (which nearly every IFC export includes) if that pset is absent
            // or incomplete on this particular part.
            double bestLen = -1;
            Dictionary<string, object?>? mainDims = null;
            string mainProfileDesc = "";

            foreach (var pid in nonFastenerParts)
            {
                var tq = GetPsetByName(pid, "Tekla Quantity", entityToPsets, psets);
                var bq = GetPsetByName(pid, "BaseQuantities", entityToPsets, psets);

                double? len = (tq.TryGetValue("Length", out var l1) && l1 is double l1d) ? l1d
                            : (bq.TryGetValue("Length", out var l2) && l2 is double l2d) ? l2d
                            : null;
                if (len is null or <= 0) continue;

                if (len.Value > bestLen)
                {
                    bestLen = len.Value;
                    mainDims = new Dictionary<string, object?>(bq);
                    foreach (var kv in tq) mainDims[kv.Key] = kv.Value;
                    // Tekla writes the section profile string into the IFC part's
                    // Description attribute (arg[3] on IFCBEAM/IFCCOLUMN/IFCMEMBER/IFCPLATE).
                    // Values like "200Z18" (Z-purlin), "120C20" (C-channel),
                    // "L40*2.5" (L-angle), "PL6X500" (plate) or "ROD12" tell
                    // us the true cross-section shape - which is otherwise
                    // impossible to recover from a raw BRep mesh.
                    if (entities.TryGetValue(pid, out var part))
                    {
                        var partArgs = StepParser.SplitTopLevel(part.ArgsRaw);
                        if (partArgs.Count > 3 && StepParser.Unwrap(partArgs[3]) is string desc)
                            mainProfileDesc = desc;
                    }
                }
            }

            string dimensionSource = "property set";

            // --- Last resort: some IFC exports carry NO "Tekla
            // Quantity"/"BaseQuantities" property sets at all (only a raw
            // BRep mesh geometry). Rather than skip the piece entirely, walk
            // each part's actual 3D geometry, collect every coordinate point
            // reachable from it, and use that point cloud's own bounding box
            // as (length, width, height) - largest extent first, since a real
            // shippable steel piece is always far longer than it is wide.
            // Validated against a real export where every part lacked
            // property-set data: this produced correct-looking dimensions
            // for all 808 assemblies (e.g. a plate whose own Description
            // text read "PL6X500" came back as 6mm x 500mm x its real
            // length - an exact match).
            if (mainDims == null)
            {
                double bestGeomLen = -1;
                double[]? bestExtents = null;
                double geometryWeightSum = 0;
                bool anyGeometryFound = false;

                foreach (var pid in nonFastenerParts)
                {
                    if (!entities.TryGetValue(pid, out var part)) continue;
                    var partArgs = StepParser.SplitTopLevel(part.ArgsRaw);
                    if (partArgs.Count < 7) continue;
                    if (StepParser.Unwrap(partArgs[6]) is not StepRef reprRef) continue;

                    var extents = GeometryBoundingBox(reprRef.Id, entities);
                    if (extents == null) continue;

                    anyGeometryFound = true;
                    double volM3 = (extents[0] * extents[1] * extents[2]) / 1e9;
                    geometryWeightSum += volM3 * SteelDensityKgPerM3;

                    if (extents[0] > bestGeomLen)
                    {
                        bestGeomLen = extents[0];
                        bestExtents = extents;
                        // Even without dimensional property sets, Tekla still
                        // writes the section string into part.Description.
                        if (partArgs.Count > 3 && StepParser.Unwrap(partArgs[3]) is string desc)
                            mainProfileDesc = desc;
                    }
                }

                if (bestExtents != null)
                {
                    mainDims = new Dictionary<string, object?>
                    {
                        ["Length"] = bestExtents[0],
                        ["Width"] = bestExtents[1],
                        ["Height"] = bestExtents[2]
                    };
                    if (weight <= 0 && anyGeometryFound) weight = geometryWeightSum;
                    dimensionSource = "geometry (estimated)";
                }
            }

            if (mainDims == null) { skipped++; continue; } // no usable data anywhere - property sets or geometry

            double GetD(Dictionary<string, object?> d, string key) =>
                d.TryGetValue(key, out var v) && v is double dv ? dv : 0;

            items.Add(new SteelItem
            {
                AssmMark = mark,
                Qty = 1,
                AssemblyName = name,
                LengthMm = GetD(mainDims, "Length"),
                WidthMm = GetD(mainDims, "Width"),
                HeightMm = mainDims.ContainsKey("Height") ? GetD(mainDims, "Height") : GetD(mainDims, "Width"),
                UnitWeightKg = weight,
                TotalWeightKg = weight,
                ProfileDesc = mainProfileDesc,
                WeightEstimated = dimensionSource == "geometry (estimated)",
                Remarks = (phase.HasValue ? $"Phase {phase} " : "") + $"[{dimensionSource}]"
            });
        }

        var job = new JobInfo
        {
            JobNo = jobNo,
            BldgNo = "",
            PhaseNo = phaseFilter.HasValue ? phaseFilter.Value.ToString("0") : "ALL",
            Customer = ""
        };

        return (job, items, skipped);
    }

    private const double SteelDensityKgPerM3 = 7850;

    /// <summary>
    /// Walks the geometry sub-tree starting from a part's Representation
    /// entity, collecting every IFCCARTESIANPOINT coordinate reachable
    /// (regardless of the exact BRep/face/loop structure in between - we
    /// don't need to understand the topology, just harvest every point),
    /// and returns the point cloud's own bounding box as
    /// [length, width, height] with length always the largest extent.
    /// Returns null if no points were found anywhere in the sub-tree.
    /// </summary>
    private static double[]? GeometryBoundingBox(int startEntityId, Dictionary<int, (string Type, string ArgsRaw)> entities)
    {
        var toVisit = new Stack<int>();
        toVisit.Push(startEntityId);
        var visited = new HashSet<int>();
        var points = new List<(double X, double Y, double Z)>();

        while (toVisit.Count > 0)
        {
            int eid = toVisit.Pop();
            if (!visited.Add(eid) || !entities.TryGetValue(eid, out var entity)) continue;

            if (entity.Type == "IFCCARTESIANPOINT")
            {
                var args = StepParser.SplitTopLevel(entity.ArgsRaw);
                if (args.Count > 0 && StepParser.Unwrap(args[0]) is List<object?> coords && coords.Count == 3
                    && coords[0] is double x && coords[1] is double y && coords[2] is double z)
                {
                    points.Add((x, y, z));
                }
                continue;
            }

            foreach (var arg in StepParser.SplitTopLevel(entity.ArgsRaw))
                CollectRefs(StepParser.Unwrap(arg), toVisit);
        }

        if (points.Count == 0) return null;

        double minX = points.Min(p => p.X), maxX = points.Max(p => p.X);
        double minY = points.Min(p => p.Y), maxY = points.Max(p => p.Y);
        double minZ = points.Min(p => p.Z), maxZ = points.Max(p => p.Z);

        var extents = new[] { maxX - minX, maxY - minY, maxZ - minZ };
        Array.Sort(extents);
        Array.Reverse(extents); // largest first: [length, width, height]
        return extents;
    }

    private static void CollectRefs(object? val, Stack<int> toVisit)
    {
        if (val is StepRef r) toVisit.Push(r.Id);
        else if (val is List<object?> list)
            foreach (var v in list) CollectRefs(v, toVisit);
    }

    private static Dictionary<string, object?> GetPsetByName(
        int eid, string psetName,
        Dictionary<int, List<int>> entityToPsets,
        Dictionary<int, PropertySet> psets)
    {
        if (entityToPsets.TryGetValue(eid, out var pids))
        {
            foreach (var pid in pids)
            {
                if (psets.TryGetValue(pid, out var pset) && pset.Name == psetName)
                    return pset.Props;
            }
        }
        return new Dictionary<string, object?>();
    }

    /// <summary>
    /// Builds three lookup tables from the flat entity dictionary:
    ///   psets          : property-set entity id -> its name + {propName: value}
    ///   entityToPsets  : any entity id -> which property-set ids describe it
    ///                    (found via IFCRELDEFINESBYPROPERTIES)
    ///   entityToParts  : an assembly's entity id -> its constituent part ids
    ///                    (found via IFCRELAGGREGATES)
    /// </summary>
    private static (Dictionary<int, PropertySet> psets,
                    Dictionary<int, List<int>> entityToPsets,
                    Dictionary<int, List<int>> entityToParts)
        BuildIndices(Dictionary<int, (string Type, string ArgsRaw)> entities)
    {
        var psets = new Dictionary<int, PropertySet>();
        foreach (var kvp in entities)
        {
            if (kvp.Value.Type != "IFCPROPERTYSET") continue;
            var args = StepParser.SplitTopLevel(kvp.Value.ArgsRaw);
            if (args.Count < 5) continue;

            string name = StepParser.Unwrap(args[2]) as string ?? "";
            var propRefs = StepParser.Unwrap(args[4]) as List<object?> ?? new List<object?>();
            var props = new Dictionary<string, object?>();

            foreach (var refObj in propRefs)
            {
                if (refObj is not StepRef sref) continue;
                if (!entities.TryGetValue(sref.Id, out var pentity)) continue;
                if (pentity.Type != "IFCPROPERTYSINGLEVALUE") continue;

                var pargs = StepParser.SplitTopLevel(pentity.ArgsRaw);
                if (pargs.Count < 3) continue;
                if (StepParser.Unwrap(pargs[0]) is string pname)
                    props[pname] = StepParser.Unwrap(pargs[2]);
            }

            psets[kvp.Key] = new PropertySet { Name = name, Props = props };
        }

        var entityToPsets = new Dictionary<int, List<int>>();
        foreach (var kvp in entities)
        {
            if (kvp.Value.Type != "IFCRELDEFINESBYPROPERTIES") continue;
            var args = StepParser.SplitTopLevel(kvp.Value.ArgsRaw);
            if (args.Count < 6) continue;

            var related = StepParser.Unwrap(args[4]) as List<object?> ?? new List<object?>();
            if (StepParser.Unwrap(args[5]) is not StepRef pdefRef) continue;

            foreach (var r in related)
            {
                if (r is not StepRef rref) continue;
                if (!entityToPsets.TryGetValue(rref.Id, out var list))
                    entityToPsets[rref.Id] = list = new List<int>();
                list.Add(pdefRef.Id);
            }
        }

        var entityToParts = new Dictionary<int, List<int>>();
        foreach (var kvp in entities)
        {
            if (kvp.Value.Type != "IFCRELAGGREGATES") continue;
            var args = StepParser.SplitTopLevel(kvp.Value.ArgsRaw);
            if (args.Count < 6) continue;

            if (StepParser.Unwrap(args[4]) is not StepRef relObjRef) continue;
            var related = StepParser.Unwrap(args[5]) as List<object?> ?? new List<object?>();

            if (!entityToParts.TryGetValue(relObjRef.Id, out var list))
                entityToParts[relObjRef.Id] = list = new List<int>();

            foreach (var r in related)
                if (r is StepRef rref) list.Add(rref.Id);
        }

        return (psets, entityToPsets, entityToParts);
    }
}
