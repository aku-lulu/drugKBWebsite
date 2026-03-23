from flask import Flask, render_template, jsonify, request
from pymongo import MongoClient
from bson import ObjectId
import json
from bson import json_util
from dotenv import load_dotenv
import os
import pubchempy as pcp
from rdkit import Chem
from rdkit.Chem import Draw
import io
import base64

load_dotenv()

app = Flask(__name__)

# MongoDB连接
client = MongoClient(os.getenv('MONGODB_URI', 'mongodb://localhost:27017/'))

# drugbank数据
db_pharmrg = client['pharmrg']
drug_collection = db_pharmrg['drug_interactions']

# wikipathway数据
db_test = client['test']
wikipathway_collection = db_test['source_wikipathway']

# chembl数据
db_chembl = client['drugkb']
chembl_drugs = db_chembl['drugs']
chembl_targets = db_chembl['targets']
chembl_relationships = db_chembl['relationships']


def parse_json(data):
    return json.loads(json_util.dumps(data))


def get_smiles_from_pubchem(drug_name):
    """从PubChem获取SMILES"""
    try:
        print(f"查询PubChem: {drug_name}")
        compounds = pcp.get_compounds(drug_name, 'name')
        if compounds and len(compounds) > 0:
            smiles = compounds[0].canonical_smiles
            if smiles:
                print(f"获取SMILES成功: {smiles[:50]}...")
                return smiles
        return None
    except Exception as e:
        print(f"PubChem查询出错: {e}")
        return None


@app.route('/')
def index():
    return render_template('index.html')


# ========== 搜索建议 ==========
@app.route('/api/suggestions')
def get_suggestions():
    query = request.args.get('q', '').strip()
    search_type = request.args.get('type', 'drug')

    if not query or len(query) < 2:
        return jsonify([])

    suggestions = []
    seen = set()

    if search_type == 'drug':
        drugs = list(drug_collection.find({
            'name': {'$regex': query, '$options': 'i'}
        }).limit(5))

        for drug in drugs:
            name = drug.get('name', '')
            if name and name not in seen:
                seen.add(name)
                suggestions.append({
                    'id': str(drug['_id']),
                    'name': name,
                    'type': 'drug',
                    'source': 'drugbank',
                    'description': drug.get('description', '')[:50] + '...' if drug.get('description') else ''
                })

        drugs = list(chembl_drugs.find({
            'name': {'$regex': query, '$options': 'i'}
        }).limit(5))

        for drug in drugs:
            name = drug.get('name', '')
            chembl_id = drug.get('chembl_id', '')
            if name and name not in seen:
                seen.add(name)
                suggestions.append({
                    'id': chembl_id,
                    'name': name,
                    'type': 'drug',
                    'source': 'chembl',
                    'description': f"ChEMBL: {chembl_id}"
                })

    elif search_type == 'gene':
        targets = list(chembl_targets.find({
            'gene_symbols': {'$regex': query, '$options': 'i'}
        }).limit(5))

        for target in targets:
            for gene in target.get('gene_symbols', []):
                if gene and gene not in seen and query.lower() in gene.lower():
                    seen.add(gene)
                    suggestions.append({
                        'id': target.get('chembl_id', ''),
                        'name': gene,
                        'full_name': target.get('name', ''),
                        'type': 'gene',
                        'source': 'chembl',
                        'description': f"基因: {gene}"
                    })

        pathways = list(wikipathway_collection.find({
            'DataNode': {
                '$elemMatch': {
                    'Type': 'GeneProduct',
                    'TextLabel': {'$regex': query, '$options': 'i'}
                }
            }
        }).limit(5))

        for pathway in pathways:
            for node in pathway.get('DataNode', []):
                if node.get('Type') == 'GeneProduct':
                    label = node.get('TextLabel', '')
                    if label and label not in seen and query.lower() in label.lower():
                        seen.add(label)
                        suggestions.append({
                            'id': str(pathway['_id']),
                            'name': label,
                            'type': 'gene',
                            'source': 'wikipathways',
                            'pathway_name': pathway.get('Name', ''),
                            'description': f"在通路中发现"
                        })

    elif search_type == 'protein':
        targets = list(chembl_targets.find({
            'name': {'$regex': query, '$options': 'i'}
        }).limit(5))

        for target in targets:
            name = target.get('name', '')
            if name and name not in seen:
                seen.add(name)
                suggestions.append({
                    'id': target.get('chembl_id', ''),
                    'name': name,
                    'type': 'protein',
                    'source': 'chembl',
                    'description': f"蛋白质靶点"
                })

        pathways = list(wikipathway_collection.find({
            'DataNode': {
                '$elemMatch': {
                    'Type': 'Protein',
                    'TextLabel': {'$regex': query, '$options': 'i'}
                }
            }
        }).limit(5))

        for pathway in pathways:
            for node in pathway.get('DataNode', []):
                if node.get('Type') == 'Protein':
                    label = node.get('TextLabel', '')
                    if label and label not in seen and query.lower() in label.lower():
                        seen.add(label)
                        suggestions.append({
                            'id': str(pathway['_id']),
                            'name': label,
                            'type': 'protein',
                            'source': 'wikipathways',
                            'pathway_name': pathway.get('Name', ''),
                            'description': f"在通路中发现"
                        })

    return jsonify(suggestions[:15])


# ========== 执行搜索 ==========
@app.route('/api/search')
def search():
    search_type = request.args.get('type', 'drug')
    query = request.args.get('q', '').strip()

    if not query or len(query) < 2:
        return jsonify([])

    results = []
    seen = set()

    if search_type == 'drug':
        drugs = list(drug_collection.find({
            '$or': [
                {'name': {'$regex': query, '$options': 'i'}},
                {'drugbank_ids': {'$regex': query, '$options': 'i'}}
            ]
        }).limit(20))

        for drug in drugs:
            name = drug.get('name', 'Unknown')
            if name not in seen:
                seen.add(name)
                results.append({
                    'id': str(drug['_id']),
                    'name': name,
                    'drugbank_ids': drug.get('drugbank_ids', []),
                    'type': 'drug',
                    'source': 'drugbank',
                    'description': drug.get('description', '')[:100] + '...' if drug.get('description') else ''
                })

        drugs = list(chembl_drugs.find({
            '$or': [
                {'name': {'$regex': query, '$options': 'i'}},
                {'chembl_id': {'$regex': query, '$options': 'i'}}
            ]
        }).limit(20))

        for drug in drugs:
            name = drug.get('name', '')
            chembl_id = drug.get('chembl_id', '')
            if name and name not in seen:
                seen.add(name)
                results.append({
                    'id': chembl_id,
                    'name': name,
                    'chembl_id': chembl_id,
                    'type': 'drug',
                    'source': 'chembl',
                    'max_phase': drug.get('basic_info', {}).get('max_phase'),
                    'description': f"ChEMBL药物"
                })

    elif search_type == 'gene':
        targets = list(chembl_targets.find({
            'gene_symbols': {'$regex': query, '$options': 'i'}
        }).limit(20))

        for target in targets:
            for gene in target.get('gene_symbols', []):
                if gene and gene not in seen and query.lower() in gene.lower():
                    seen.add(gene)
                    results.append({
                        'id': target.get('chembl_id', ''),
                        'name': gene,
                        'full_name': target.get('name', ''),
                        'type': 'gene',
                        'source': 'chembl',
                        'organism': target.get('organism', ''),
                        'description': f"基因: {gene}"
                    })

        pathways = list(wikipathway_collection.find({
            'DataNode': {
                '$elemMatch': {
                    'Type': 'GeneProduct',
                    'TextLabel': {'$regex': query, '$options': 'i'}
                }
            }
        }).limit(20))

        for pathway in pathways:
            for node in pathway.get('DataNode', []):
                if node.get('Type') == 'GeneProduct':
                    label = node.get('TextLabel', '')
                    if label and label not in seen and query.lower() in label.lower():
                        seen.add(label)
                        results.append({
                            'id': str(pathway['_id']),
                            'name': label,
                            'type': 'gene',
                            'source': 'wikipathways',
                            'pathway_name': pathway.get('Name', ''),
                            'description': f"在通路 {pathway.get('Name', '')} 中"
                        })

    elif search_type == 'protein':
        targets = list(chembl_targets.find({
            'name': {'$regex': query, '$options': 'i'}
        }).limit(20))

        for target in targets:
            name = target.get('name', '')
            if name and name not in seen:
                seen.add(name)
                results.append({
                    'id': target.get('chembl_id', ''),
                    'name': name,
                    'type': 'protein',
                    'source': 'chembl',
                    'organism': target.get('organism', ''),
                    'description': f"蛋白质靶点"
                })

        pathways = list(wikipathway_collection.find({
            'DataNode': {
                '$elemMatch': {
                    'Type': 'Protein',
                    'TextLabel': {'$regex': query, '$options': 'i'}
                }
            }
        }).limit(20))

        for pathway in pathways:
            for node in pathway.get('DataNode', []):
                if node.get('Type') == 'Protein':
                    label = node.get('TextLabel', '')
                    if label and label not in seen and query.lower() in label.lower():
                        seen.add(label)
                        results.append({
                            'id': str(pathway['_id']),
                            'name': label,
                            'type': 'protein',
                            'source': 'wikipathways',
                            'pathway_name': pathway.get('Name', ''),
                            'description': f"在通路 {pathway.get('Name', '')} 中"
                        })

    return jsonify(results)


@app.route('/api/drug/<identifier>/structure')
def get_drug_structure(identifier):
    """获取药物的二维结构图像"""
    try:
        drug_name = None

        # 获取药物名称
        if ObjectId.is_valid(identifier):
            drug = drug_collection.find_one({'_id': ObjectId(identifier)})
            if drug:
                drug_name = drug.get('name', '')

        if not drug_name:
            drug = drug_collection.find_one({'drugbank_ids': identifier})
            if drug:
                drug_name = drug.get('name', '')

        if not drug_name:
            drug = drug_collection.find_one({'name': identifier})
            if drug:
                drug_name = drug.get('name', '')

        if not drug_name and identifier.startswith('CHEMBL'):
            chembl_drug = chembl_drugs.find_one({'chembl_id': identifier})
            if chembl_drug:
                drug_name = chembl_drug.get('name', '')

        if not drug_name:
            return jsonify({'error': 'Drug not found'}), 404

        print(f"正在获取分子结构: {drug_name}")

        # 从 ChEMBL 数据库直接读取 SMILES
        smiles = None
        if identifier.startswith('CHEMBL'):
            chembl_drug = chembl_drugs.find_one({'chembl_id': identifier})
            if chembl_drug:
                # 尝试多个可能存储 SMILES 的位置
                if chembl_drug.get('structure', {}).get('smiles'):
                    smiles = chembl_drug['structure']['smiles']
                    print(f"从ChEMBL structure获取SMILES成功")
                elif chembl_drug.get('properties', {}).get('smiles'):
                    smiles = chembl_drug['properties']['smiles']
                    print(f"从ChEMBL properties获取SMILES成功")

        # 如果 ChEMBL 没有，从 DrugBank 获取
        if not smiles and drug_name:
            drugbank_drug = drug_collection.find_one({'name': drug_name})
            if drugbank_drug and drugbank_drug.get('structure', {}).get('smiles'):
                smiles = drugbank_drug['structure']['smiles']
                print(f"从DrugBank获取SMILES成功")

        # 如果都没有，使用 PubChem API
        if not smiles:
            try:
                import requests
                import urllib.parse

                # 清理名称
                import re
                clean_name = re.sub(r'[^\w\s]', '', drug_name)
                clean_name = re.sub(r'\s+', ' ', clean_name).strip()

                # PubChem API - 使用 SMILES 直接返回
                encoded = urllib.parse.quote(clean_name)
                url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{encoded}/property/IsomericSMILES/JSON"

                print(f"请求URL: {url}")
                response = requests.get(url, timeout=10)
                print(f"响应状态: {response.status_code}")

                if response.status_code == 200:
                    data = response.json()
                    print(f"API返回数据: {data}")

                    # 正确解析 PubChem 返回的数据
                    if 'PropertyTable' in data and 'Properties' in data['PropertyTable']:
                        props = data['PropertyTable']['Properties']
                        if props and len(props) > 0:
                            # 尝试多个可能的字段名
                            smiles = props[0].get('IsomericSMILES')
                            if not smiles:
                                smiles = props[0].get('CanonicalSMILES')
                            if not smiles:
                                smiles = props[0].get('SMILES')
                            if smiles:
                                print(f"从PubChem API获取SMILES成功: {smiles[:50]}...")

                # 如果上面的URL不行，尝试另一个PubChem API端点
                if not smiles:
                    url2 = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{encoded}/property/SMILES/JSON"
                    response = requests.get(url2, timeout=10)
                    if response.status_code == 200:
                        data = response.json()
                        if 'PropertyTable' in data and 'Properties' in data['PropertyTable']:
                            props = data['PropertyTable']['Properties']
                            if props and len(props) > 0:
                                smiles = props[0].get('SMILES')
                                if smiles:
                                    print(f"从PubChem SMILES API获取成功")

            except Exception as e:
                print(f"PubChem API失败: {e}")

        if not smiles:
            return jsonify({'error': f'未找到 {drug_name} 的结构信息'}), 404

        # 生成图像
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return jsonify({'error': 'Invalid SMILES'}), 400

        img = Draw.MolToImage(mol, size=(300, 300))
        img_buffer = io.BytesIO()
        img.save(img_buffer, format='PNG')
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode('utf-8')

        return jsonify({
            'image': img_base64,
            'smiles': smiles,
            'name': drug_name
        })

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ========== 分子信息路由 ==========
@app.route('/api/drug/<identifier>/molecular_info')
def get_molecular_info(identifier):
    try:
        if ObjectId.is_valid(identifier):
            drug = drug_collection.find_one({'_id': ObjectId(identifier)})
            if drug:
                return jsonify({
                    'name': drug.get('name', ''),
                    'drugbank_ids': drug.get('drugbank_ids', []),
                    'cas_number': drug.get('cas_number', 'N/A'),
                    'uni': drug.get('uni', 'N/A'),
                    'state': drug.get('state', 'N/A'),
                    'groups': drug.get('groups', []),
                    'description': drug.get('description', ''),
                    'source': 'drugbank'
                })

        chembl_drug = chembl_drugs.find_one({'chembl_id': identifier})
        if chembl_drug:
            return jsonify({
                'name': chembl_drug.get('name', ''),
                'chembl_id': chembl_drug.get('chembl_id', ''),
                'source': 'chembl',
                'cas_number': 'N/A',
                'uni': chembl_drug.get('properties', {}).get('full_molformula', 'N/A'),
                'state': chembl_drug.get('basic_info', {}).get('max_phase', 'N/A'),
                'groups': chembl_drug.get('basic_info', {}).get('molecule_type', 'N/A'),
                'description': f"ChEMBL药物",
                'basic_info': chembl_drug.get('basic_info', {}),
                'properties': chembl_drug.get('properties', {})
            })

        return jsonify({'error': 'Not found'}), 404

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ========== 药物详情路由（当前选择用） ==========
@app.route('/api/drug/<identifier>')
def get_drug(identifier):
    """获取单个药物详情"""
    try:
        if ObjectId.is_valid(identifier):
            drug = drug_collection.find_one({'_id': ObjectId(identifier)})
            if drug:
                return jsonify({
                    'name': drug.get('name', ''),
                    'drugbank_ids': drug.get('drugbank_ids', []),
                    'cas_number': drug.get('cas_number', 'N/A'),
                    'uni': drug.get('uni', 'N/A'),
                    'state': drug.get('state', 'N/A'),
                    'groups': drug.get('groups', []),
                    'description': drug.get('description', ''),
                    'source': 'drugbank'
                })

        drug = drug_collection.find_one({'drugbank_ids': identifier})
        if drug:
            return jsonify({
                'name': drug.get('name', ''),
                'drugbank_ids': drug.get('drugbank_ids', []),
                'cas_number': drug.get('cas_number', 'N/A'),
                'uni': drug.get('uni', 'N/A'),
                'state': drug.get('state', 'N/A'),
                'groups': drug.get('groups', []),
                'description': drug.get('description', ''),
                'source': 'drugbank'
            })

        drug = drug_collection.find_one({'name': identifier})
        if drug:
            return jsonify({
                'name': drug.get('name', ''),
                'drugbank_ids': drug.get('drugbank_ids', []),
                'cas_number': drug.get('cas_number', 'N/A'),
                'uni': drug.get('uni', 'N/A'),
                'state': drug.get('state', 'N/A'),
                'groups': drug.get('groups', []),
                'description': drug.get('description', ''),
                'source': 'drugbank'
            })

        chembl_drug = chembl_drugs.find_one({'chembl_id': identifier})
        if chembl_drug:
            return jsonify({
                'name': chembl_drug.get('name', ''),
                'chembl_id': chembl_drug.get('chembl_id', ''),
                'source': 'chembl',
                'cas_number': 'N/A',
                'uni': chembl_drug.get('properties', {}).get('full_molformula', 'N/A'),
                'state': chembl_drug.get('basic_info', {}).get('max_phase', 'N/A'),
                'groups': chembl_drug.get('basic_info', {}).get('molecule_type', 'N/A'),
                'description': f"ChEMBL药物",
                'basic_info': chembl_drug.get('basic_info', {}),
                'properties': chembl_drug.get('properties', {})
            })

        return jsonify({'error': 'Not found'}), 404

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ========== ChEMBL图谱 ==========
@app.route('/api/chembl/graph/<chembl_id>')
def get_chembl_graph(chembl_id):
    try:
        item = chembl_drugs.find_one({'chembl_id': chembl_id})
        item_type = 'drug'
        item_name = chembl_id

        if not item:
            item = chembl_targets.find_one({'chembl_id': chembl_id})
            if item:
                item_type = 'gene' if item.get('gene_symbols') else 'protein'
                item_name = item.get('name', chembl_id)

        if not item:
            return jsonify({'error': '未找到'}), 404

        relationships = list(chembl_relationships.find({
            '$or': [
                {'source_id': chembl_id},
                {'target_id': chembl_id}
            ]
        }).limit(30))

        nodes = [{
            'id': chembl_id,
            'label': item_name,
            'group': 'center',
            'type': item_type,
            'icon': '💊' if item_type == 'drug' else ('🧬' if item_type == 'gene' else '⚛️')
        }]
        node_ids = {chembl_id}
        edges = []

        for rel in relationships:
            other_id = rel['target_id'] if rel['source_id'] == chembl_id else rel['source_id']
            other_type = rel['target_type'] if rel['source_id'] == chembl_id else rel['source_type']

            if other_id not in node_ids:
                other_info = None
                other_name = other_id

                if other_type == 'DRUG':
                    other_info = chembl_drugs.find_one({'chembl_id': other_id})
                else:
                    other_info = chembl_targets.find_one({'chembl_id': other_id})

                if other_info:
                    other_name = other_info.get('name', other_id)

                node_group = 'drug' if other_type == 'DRUG' else (
                    'gene' if other_info and other_info.get('gene_symbols') else 'protein')
                node_icon = '💊' if node_group == 'drug' else ('🧬' if node_group == 'gene' else '⚛️')

                nodes.append({
                    'id': other_id,
                    'label': other_name,
                    'group': node_group,
                    'type': node_group,
                    'icon': node_icon
                })
                node_ids.add(other_id)

            edges.append({
                'from': chembl_id,
                'to': other_id,
                'title': rel.get('mechanism', '相互作用')
            })

        return jsonify({
            'nodes': nodes,
            'edges': edges,
            'center_id': chembl_id,
            'drug_name': item_name,
            'type': item_type
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ========== DrugBank图谱 ==========
@app.route('/api/graph/<identifier>')
def get_drug_graph(identifier):
    try:
        target_drug = None

        if ObjectId.is_valid(identifier):
            target_drug = drug_collection.find_one({'_id': ObjectId(identifier)})
        if not target_drug:
            target_drug = drug_collection.find_one({'drugbank_ids': identifier})
        if not target_drug:
            target_drug = drug_collection.find_one({'name': identifier})

        if not target_drug:
            return jsonify({'error': 'Drug not found'}), 404

        nodes = [{
            'id': identifier,
            'label': target_drug.get('name', 'Unknown'),
            'group': 'center',
            'type': 'drug',
            'icon': '💊'
        }]
        node_ids = {identifier}
        edges = []

        for interaction in target_drug.get('interacts_with', [])[:15]:
            drugbank_id = interaction.get('drugbank_id')
            if not drugbank_id:
                continue

            related = drug_collection.find_one({'drugbank_ids': drugbank_id})
            if related:
                node_id = str(related['_id'])
                if node_id not in node_ids:
                    nodes.append({
                        'id': node_id,
                        'label': related.get('name', drugbank_id),
                        'group': 'related',
                        'type': 'drug',
                        'icon': '💊'
                    })
                    node_ids.add(node_id)

                edges.append({
                    'from': identifier,
                    'to': node_id,
                    'title': interaction.get('description', '相互作用')
                })

        return jsonify({
            'nodes': nodes,
            'edges': edges,
            'center_id': identifier,
            'drug_name': target_drug.get('name', 'Unknown'),
            'type': 'drug'
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ========== 通路图谱 ==========
@app.route('/api/pathway/graph/<pathway_id>')
def get_pathway_graph(pathway_id):
    try:
        if not ObjectId.is_valid(pathway_id):
            return jsonify({'error': 'Invalid ID'}), 400

        pathway = wikipathway_collection.find_one({'_id': ObjectId(pathway_id)})
        if not pathway:
            return jsonify({'error': 'Pathway not found'}), 404

        nodes = [{
            'id': pathway_id,
            'label': pathway.get('Name', 'Unknown'),
            'group': 'pathway',
            'type': 'pathway',
            'icon': '🔬'
        }]
        node_labels = {pathway.get('Name', '')}
        edges = []

        for node in pathway.get('DataNode', [])[:30]:
            node_type = node.get('Type')
            node_label = node.get('TextLabel', '')

            if node_type not in ['GeneProduct', 'Protein']:
                continue

            if node_label in node_labels:
                continue

            node_id = f"{pathway_id}_{node_label}"
            node_icon = '🧬' if node_type == 'GeneProduct' else '⚛️'

            nodes.append({
                'id': node_id,
                'label': node_label,
                'group': 'gene' if node_type == 'GeneProduct' else 'protein',
                'type': 'gene' if node_type == 'GeneProduct' else 'protein',
                'icon': node_icon
            })
            node_labels.add(node_label)

            edges.append({
                'from': pathway_id,
                'to': node_id,
                'title': 'part of pathway'
            })

        return jsonify({
            'nodes': nodes,
            'edges': edges,
            'center_id': pathway_id,
            'pathway_name': pathway.get('Name', 'Unknown')
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)