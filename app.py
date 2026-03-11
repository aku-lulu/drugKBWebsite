from flask import Flask, render_template, jsonify, request
from pymongo import MongoClient
from bson import ObjectId
import json
from bson import json_util
from dotenv import load_dotenv
import os

load_dotenv()

app = Flask(__name__)

# MongoDB连接
client = MongoClient(os.getenv('MONGODB_URI', 'mongodb://localhost:27017/'))

# drugbank数据在pharmrg数据库的drug_interactions集合中
db_pharmrg = client['pharmrg']
drug_collection = db_pharmrg['drug_interactions']

# wikipathway数据在test数据库的source_wikipathway集合中
db_test = client['test']
wikipathway_collection = db_test['source_wikipathway']


def parse_json(data):
    """将MongoDB数据转换为JSON可序列化格式"""
    return json.loads(json_util.dumps(data))


@app.route('/')
def index():
    """主页"""
    return render_template('index.html')


@app.route('/api/suggestions')
def get_suggestions():
    """获取搜索建议"""
    query = request.args.get('q', '').strip()
    search_type = request.args.get('type', 'drug')

    if not query or len(query) < 2:
        return jsonify([])

    suggestions = []
    seen_items = set()

    if search_type == 'drug':
        # 搜索药物 - DrugBank
        print(f"搜索药物: {query} 在 pharmrg.drug_interactions 中")

        # 按名称搜索
        name_matches = drug_collection.find({
            'name': {'$regex': query, '$options': 'i'}
        }).limit(10)

        for drug in name_matches:
            drug_name = drug.get('name', '')
            if drug_name and drug_name not in seen_items:
                seen_items.add(drug_name)
                suggestions.append({
                    'id': str(drug['_id']),
                    'name': drug_name,
                    'matched_field': 'name',
                    'drugbank_ids': drug.get('drugbank_ids', [])[:3],
                    'type': 'drug',
                    'source': 'drugbank',
                    'description': drug.get('description', '')[:50] + '...' if drug.get('description') else ''
                })

        # 按DrugBank ID搜索
        id_matches = drug_collection.find({
            'drugbank_ids': {'$regex': f'^{query}', '$options': 'i'}
        }).limit(10)

        for drug in id_matches:
            drug_name = drug.get('name', '')
            if drug_name not in seen_items:
                matched_ids = [id for id in drug.get('drugbank_ids', [])
                               if id.lower().startswith(query.lower())]
                if matched_ids:
                    seen_items.add(drug_name)
                    suggestions.append({
                        'id': str(drug['_id']),
                        'name': drug_name,
                        'matched_field': 'drugbank_id',
                        'matched_value': matched_ids[0],
                        'drugbank_ids': drug.get('drugbank_ids', [])[:3],
                        'type': 'drug',
                        'source': 'drugbank',
                        'description': drug.get('description', '')[:50] + '...' if drug.get('description') else ''
                    })

    elif search_type == 'gene':
        # 搜索基因 - 从WikiPathways
        print(f"搜索基因: {query} 在 test.source_wikipathway 中")

        pathways = wikipathway_collection.find({
            'DataNode': {
                '$elemMatch': {
                    'Type': 'GeneProduct',
                    'TextLabel': {'$regex': query, '$options': 'i'}
                }
            }
        }).limit(50)

        for pathway in pathways:
            pathway_name = pathway.get('Name', 'Unknown Pathway')
            pathway_id = str(pathway['_id'])

            for node in pathway.get('DataNode', []):
                if node.get('Type') == 'GeneProduct':
                    node_label = node.get('TextLabel', '')
                    if query.lower() in node_label.lower():
                        item_key = f"{node_label}_{pathway_id}"

                        if item_key not in seen_items:
                            seen_items.add(item_key)

                            xref = node.get('Xref', {})
                            xref_info = f"{xref.get('Database', '')}:{xref.get('ID', '')}" if xref else ''

                            suggestions.append({
                                'id': pathway_id,
                                'node_id': f"{pathway_id}_{node_label}",
                                'node_label': node_label,
                                'name': node_label,
                                'pathway_name': pathway_name,
                                'organism': pathway.get('Organism', ''),
                                'matched_field': 'gene',
                                'matched_value': node_label,
                                'type': 'gene',
                                'source': 'wikipathways',
                                'xref': xref_info,
                                'description': f"在通路 {pathway_name} 中发现"
                            })

    elif search_type == 'protein':
        # 搜索蛋白质 - 从WikiPathways
        print(f"搜索蛋白质: {query} 在 test.source_wikipathway 中")

        pathways = wikipathway_collection.find({
            'DataNode': {
                '$elemMatch': {
                    'Type': 'Protein',
                    'TextLabel': {'$regex': query, '$options': 'i'}
                }
            }
        }).limit(50)

        for pathway in pathways:
            pathway_name = pathway.get('Name', 'Unknown Pathway')
            pathway_id = str(pathway['_id'])

            for node in pathway.get('DataNode', []):
                if node.get('Type') == 'Protein':
                    node_label = node.get('TextLabel', '')
                    if query.lower() in node_label.lower():
                        item_key = f"{node_label}_{pathway_id}"

                        if item_key not in seen_items:
                            seen_items.add(item_key)

                            xref = node.get('Xref', {})
                            xref_info = f"{xref.get('Database', '')}:{xref.get('ID', '')}" if xref else ''

                            suggestions.append({
                                'id': pathway_id,
                                'node_id': f"{pathway_id}_{node_label}",
                                'node_label': node_label,
                                'name': node_label,
                                'pathway_name': pathway_name,
                                'organism': pathway.get('Organism', ''),
                                'matched_field': 'protein',
                                'matched_value': node_label,
                                'type': 'protein',
                                'source': 'wikipathways',
                                'xref': xref_info,
                                'description': f"在通路 {pathway_name} 中发现"
                            })

    return jsonify(suggestions[:15])


@app.route('/api/search')
def search():
    """执行搜索 - 返回所有匹配结果"""
    search_type = request.args.get('type', 'drug')
    query = request.args.get('q', '').strip()

    if not query or len(query) < 2:
        return jsonify([])

    results = []
    seen_items = set()

    if search_type == 'drug':
        drugs = list(drug_collection.find({
            '$or': [
                {'name': {'$regex': query, '$options': 'i'}},
                {'drugbank_ids': {'$regex': query, '$options': 'i'}}
            ]
        }).limit(30))

        for drug in drugs:
            drug_name = drug.get('name', 'Unknown')
            if drug_name not in seen_items:
                seen_items.add(drug_name)
                results.append({
                    'id': str(drug['_id']),
                    'name': drug_name,
                    'drugbank_ids': drug.get('drugbank_ids', []),
                    'type': 'drug',
                    'source': 'drugbank',
                    'description': drug.get('description', '')[:100] + '...' if drug.get('description') else ''
                })

    elif search_type == 'gene':
        pathways = list(wikipathway_collection.find({
            'DataNode': {
                '$elemMatch': {
                    'Type': 'GeneProduct',
                    'TextLabel': {'$regex': query, '$options': 'i'}
                }
            }
        }).limit(50))

        for pathway in pathways:
            pathway_name = pathway.get('Name', 'Unknown Pathway')
            pathway_id = str(pathway['_id'])

            for node in pathway.get('DataNode', []):
                if node.get('Type') == 'GeneProduct':
                    node_label = node.get('TextLabel', '')
                    if query.lower() in node_label.lower():
                        item_key = f"{node_label}_{pathway_id}"

                        if item_key not in seen_items:
                            seen_items.add(item_key)
                            xref = node.get('Xref', {})

                            results.append({
                                'id': pathway_id,
                                'node_id': f"{pathway_id}_{node_label}",
                                'node_label': node_label,
                                'name': node_label,
                                'pathway_name': pathway_name,
                                'organism': pathway.get('Organism', ''),
                                'type': 'gene',
                                'source': 'wikipathways',
                                'xref': f"{xref.get('Database', '')}:{xref.get('ID', '')}" if xref else '',
                                'description': f"在通路 {pathway_name} 中发现"
                            })

    elif search_type == 'protein':
        pathways = list(wikipathway_collection.find({
            'DataNode': {
                '$elemMatch': {
                    'Type': 'Protein',
                    'TextLabel': {'$regex': query, '$options': 'i'}
                }
            }
        }).limit(50))

        for pathway in pathways:
            pathway_name = pathway.get('Name', 'Unknown Pathway')
            pathway_id = str(pathway['_id'])

            for node in pathway.get('DataNode', []):
                if node.get('Type') == 'Protein':
                    node_label = node.get('TextLabel', '')
                    if query.lower() in node_label.lower():
                        item_key = f"{node_label}_{pathway_id}"

                        if item_key not in seen_items:
                            seen_items.add(item_key)
                            xref = node.get('Xref', {})

                            results.append({
                                'id': pathway_id,
                                'node_id': f"{pathway_id}_{node_label}",
                                'node_label': node_label,
                                'name': node_label,
                                'pathway_name': pathway_name,
                                'organism': pathway.get('Organism', ''),
                                'type': 'protein',
                                'source': 'wikipathways',
                                'xref': f"{xref.get('Database', '')}:{xref.get('ID', '')}" if xref else '',
                                'description': f"在通路 {pathway_name} 中发现"
                            })

    return jsonify(results)


@app.route('/api/pathway/<pathway_id>')
def get_pathway(pathway_id):
    """获取通路详情"""
    try:
        pathway = None

        if ObjectId.is_valid(pathway_id):
            pathway = wikipathway_collection.find_one({'_id': ObjectId(pathway_id)})

        if pathway:
            return jsonify(parse_json(pathway))

        return jsonify({'error': 'Pathway not found'}), 404

    except Exception as e:
        print(f"Error in get_pathway: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/pathway/graph/<pathway_id>')
def get_pathway_graph(pathway_id):
    """获取通路的知识图谱数据 - 自动去重"""
    try:
        # 获取查询参数中的目标节点标签
        target_node_label = request.args.get('target', '')

        pathway = None

        if ObjectId.is_valid(pathway_id):
            pathway = wikipathway_collection.find_one({'_id': ObjectId(pathway_id)})

        if not pathway:
            return jsonify({'error': 'Pathway not found'}), 404

        print(f"========== 构建通路图谱: {pathway.get('Name')} ==========")

        nodes = []
        edges = []
        node_labels = set()  # 用于按标签去重
        target_node_id = None

        # 添加通路中心节点
        pathway_id_str = str(pathway['_id'])
        pathway_node = {
            'id': pathway_id_str,
            'label': pathway.get('Name', 'Unknown Pathway'),
            'title': f"Pathway: {pathway.get('Name')}\nOrganism: {pathway.get('Organism')}\nVersion: {pathway.get('Version')}\nAuthor: {pathway.get('Author', 'N/A')}",
            'group': 'pathway',
            'type': 'pathway',
            'value': 30,
            'shape': 'box',
            'color': {
                'background': '#9c27b0',
                'border': '#ffffff',
                'highlight': {
                    'background': '#7b1fa2',
                    'border': '#ffffff'
                }
            }
        }
        nodes.append(pathway_node)
        node_labels.add(pathway.get('Name', 'Unknown Pathway'))

        # 获取DataNode数组
        data_nodes = pathway.get('DataNode', [])

        gene_count = 0
        protein_count = 0

        # 处理每个数据节点，自动去重
        for idx, node in enumerate(data_nodes):
            node_type = node.get('Type', 'Unknown')
            node_label = node.get('TextLabel', '')

            # 只处理 GeneProduct 和 Protein 类型
            if node_type not in ['GeneProduct', 'Protein']:
                continue

            # 按标签去重
            if node_label in node_labels:
                continue

            node_xref = node.get('Xref', {})

            # 生成唯一节点ID
            node_unique_id = f"{pathway_id_str}_{node_label}_{node_type}"

            # 确定节点组和颜色
            if node_type == 'GeneProduct':
                group = 'gene'
                base_color = '#4caf50'
                display_type = 'gene'
                gene_count += 1
            else:  # Protein
                group = 'protein'
                base_color = '#ff9800'
                display_type = 'protein'
                protein_count += 1

            # 检查是否是目标节点
            is_target = target_node_label and node_label.lower() == target_node_label.lower()
            if is_target:
                target_node_id = node_unique_id
                # 目标节点使用特殊颜色和大小
                node_color = {
                    'background': '#ffffff',
                    'border': base_color,
                    'highlight': {
                        'background': '#ffffff',
                        'border': '#00bcd4'
                    }
                }
                node_size = 30
                node_border_width = 4
                node_group = f'target_{group}'
            else:
                node_color = {
                    'background': base_color,
                    'border': '#ffffff',
                    'highlight': {
                        'background': base_color,
                        'border': '#00bcd4'
                    }
                }
                node_size = 20
                node_border_width = 2
                node_group = group

            # 创建节点
            pathway_node = {
                'id': node_unique_id,
                'label': node_label,
                'title': f"Type: {node_type}\nLabel: {node_label}\nDatabase: {node_xref.get('Database', 'N/A')}\nID: {node_xref.get('ID', 'N/A')}",
                'group': node_group,
                'type': display_type,
                'value': node_size,
                'borderWidth': node_border_width,
                'color': node_color,
                'is_target': is_target
            }

            nodes.append(pathway_node)
            node_labels.add(node_label)

            # 添加从通路到节点的边
            edge = {
                'id': f"edge_{pathway_id_str}_{node_unique_id}",
                'from': pathway_id_str,
                'to': node_unique_id,
                'title': f"Part of {pathway.get('Name')}",
                'width': 2,
                'color': '#9c27b0',
                'dashes': False
            }
            edges.append(edge)

        # 如果没有找到目标节点，但提供了目标标签，尝试查找近似匹配
        if target_node_label and not target_node_id:
            for node in nodes:
                if node['type'] in ['gene', 'protein'] and target_node_label.lower() in node['label'].lower():
                    target_node_id = node['id']
                    # 更新节点样式
                    node['borderWidth'] = 4
                    node['color']['border'] = '#ffffff'
                    node['color']['background'] = '#00bcd4'
                    node['is_target'] = True
                    node['group'] = f"target_{node['type']}"
                    break

        response_data = {
            'nodes': nodes,
            'edges': edges,
            'center_id': pathway_id_str,
            'target_node_id': target_node_id,
            'pathway_name': pathway.get('Name', 'Unknown'),
            'organism': pathway.get('Organism', 'Unknown'),
            'gene_count': gene_count,
            'protein_count': protein_count,
            'type': 'pathway'
        }

        print(f"图谱构建完成: {len(nodes)} 个节点")
        return jsonify(response_data)

    except Exception as e:
        print(f"Error in get_pathway_graph: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/pathway/node/<pathway_id>/<path:node_label>')
def get_pathway_node_details(pathway_id, node_label):
    """获取通路中特定节点的详细信息"""
    try:
        pathway = None

        if ObjectId.is_valid(pathway_id):
            pathway = wikipathway_collection.find_one({'_id': ObjectId(pathway_id)})

        if not pathway:
            return jsonify({'error': 'Pathway not found'}), 404

        # 查找匹配的节点
        target_node = None
        for node in pathway.get('DataNode', []):
            if node.get('TextLabel', '') == node_label:
                target_node = node
                break

        if not target_node:
            return jsonify({'error': 'Node not found'}), 404

        node_type = target_node.get('Type', 'Unknown')
        xref = target_node.get('Xref', {})

        # 构建节点详细信息
        node_details = {
            'name': target_node.get('TextLabel', ''),
            'type': 'gene' if node_type == 'GeneProduct' else 'protein',
            'node_type': node_type,
            'pathway_name': pathway.get('Name', ''),
            'organism': pathway.get('Organism', ''),
            'xref_database': xref.get('Database', 'N/A'),
            'xref_id': xref.get('ID', 'N/A'),
            'description': f"位于通路 {pathway.get('Name')} 中"
        }

        return jsonify(node_details)

    except Exception as e:
        print(f"Error in get_pathway_node_details: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/drug/<identifier>')
def get_drug(identifier):
    """获取单个药物详情"""
    try:
        drug = None

        if ObjectId.is_valid(identifier):
            drug = drug_collection.find_one({'_id': ObjectId(identifier)})

        if not drug:
            drug = drug_collection.find_one({'drugbank_ids': identifier})

        if not drug:
            drug = drug_collection.find_one({'name': identifier})

        if drug:
            return jsonify(parse_json(drug))

        return jsonify({'error': 'Drug not found'}), 404

    except Exception as e:
        print(f"Error in get_drug: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/graph/<identifier>')
def get_drug_graph(identifier):
    """获取药物的知识图谱数据 - 自动去重"""
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

        print(f"========== 构建药物图谱: {target_drug.get('name')} ==========")

        show_full = request.args.get('full', 'false').lower() == 'true'

        nodes = []
        edges = []
        drug_names = set()  # 用于按名称去重

        center_id = str(target_drug['_id'])
        center_node = {
            'id': center_id,
            'label': target_drug.get('name', 'Unknown'),
            'title': f"名称: {target_drug.get('name')}\nID: {target_drug.get('_id')}",
            'group': 'center',
            'type': 'drug',
            'value': 30,
            'is_target': True
        }
        nodes.append(center_node)
        drug_names.add(target_drug.get('name', 'Unknown'))

        interacts_with = target_drug.get('interacts_with', [])
        total_interactions = len(interacts_with)

        # 按drugbank_id去重
        unique_interactions = {}
        for interaction in interacts_with:
            drugbank_id = interaction.get('drugbank_id')
            if drugbank_id and drugbank_id not in unique_interactions:
                unique_interactions[drugbank_id] = interaction

        MAX_NODES = 15
        if show_full:
            MAX_NODES = len(unique_interactions)

        interactions_to_show = list(unique_interactions.values())[:MAX_NODES]

        for idx, interaction in enumerate(interactions_to_show):
            drugbank_id = interaction.get('drugbank_id')
            description = interaction.get('description', '相互作用描述')

            if not drugbank_id:
                continue

            related_drug = drug_collection.find_one({'drugbank_ids': drugbank_id})

            if related_drug:
                node_id = str(related_drug['_id'])
                node_name = related_drug.get('name', drugbank_id)

                # 按名称去重
                if node_name not in drug_names:
                    node = {
                        'id': node_id,
                        'label': node_name,
                        'title': f"名称: {node_name}\n相互作用: {description}",
                        'group': 'related',
                        'type': 'drug',
                        'value': 20,
                        'is_target': False
                    }
                    nodes.append(node)
                    drug_names.add(node_name)

                    # 添加边
                    edge = {
                        'id': f"edge_{center_id}_{node_id}_{idx}",
                        'from': center_id,
                        'to': node_id,
                        'title': description,
                        'width': 2,
                        'color': '#00bcd4'
                    }
                    edges.append(edge)

        remaining = len(unique_interactions) - len(interactions_to_show)
        if not show_full and remaining > 0:
            more_node_id = f"more_{center_id}"
            more_node = {
                'id': more_node_id,
                'label': f"+{remaining} 更多",
                'title': f"还有 {remaining} 个未显示的相互作用关系\n双击查看全部",
                'group': 'more',
                'type': 'more',
                'value': 10,
                'shape': 'box',
                'color': {
                    'background': '#4a4f5a',
                    'border': '#8a8f99',
                    'highlight': {
                        'background': '#5a5f6a',
                        'border': '#00bcd4'
                    }
                }
            }
            nodes.append(more_node)

            more_edge = {
                'id': f"edge_{center_id}_more",
                'from': center_id,
                'to': more_node_id,
                'title': f"点击查看全部 {len(unique_interactions)} 个相互作用",
                'width': 1,
                'color': '#8a8f99',
                'dashes': True
            }
            edges.append(more_edge)

        response_data = {
            'nodes': nodes,
            'edges': edges,
            'center_id': center_id,
            'target_node_id': center_id,
            'drug_name': target_drug.get('name', 'Unknown'),
            'has_more': not show_full and remaining > 0,
            'remaining_count': remaining,
            'type': 'drug'
        }

        print(f"图谱构建完成: {len(nodes)} 个节点")
        return jsonify(response_data)

    except Exception as e:
        print(f"Error in get_drug_graph: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/drug/<identifier>/molecular_info')
def get_molecular_info(identifier):
    """获取分子结构信息"""
    try:
        drug = None

        if ObjectId.is_valid(identifier):
            drug = drug_collection.find_one({'_id': ObjectId(identifier)})

        if not drug:
            drug = drug_collection.find_one({'drugbank_ids': identifier})

        if not drug:
            drug = drug_collection.find_one({'name': identifier})

        if drug:
            molecular_info = {
                'name': drug.get('name', ''),
                'drugbank_ids': drug.get('drugbank_ids', []),
                'cas_number': drug.get('cas_number', 'N/A'),
                'uni': drug.get('uni', 'N/A'),
                'state': drug.get('state', 'N/A'),
                'groups': drug.get('groups', []),
                'food_interactions': drug.get('food_interactions', []),
                'description': drug.get('description', '')
            }
            return jsonify(molecular_info)

        return jsonify({'error': 'Not found'}), 404

    except Exception as e:
        print(f"Error in get_molecular_info: {str(e)}")
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)